// Server-side owner of the active attention-rules state. It never touches the
// rules file: every read, write, install, and watch goes through the host entry
// (ports-host.ts). Watcher signals and explicit reads converge on `apply`, which
// validates with the pure core and keeps the last valid document on a bad file.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { attentionRulesHostSignals } from "./attention-rules-host-contract";
import { portScanContract } from "./port-scan-contract";
import {
  applyGlobalSelection,
  ATTENTION_RULES_CHANNEL,
  ATTENTION_RULES_EXAMPLE,
  attentionRulesDocumentSchema,
  parseAttentionRules,
  rulesDocumentVersion,
  type AttentionRulesDocument,
  type GlobalAttentionSelection,
} from "./attention";

export const attentionRulesStateSchema = z.object({
  /** What the last read saw on disk: no file, a file, or nothing read yet. */
  file: z.enum(["absent", "present", "unknown"]),
  /** Stamp of the active document; null when no custom behaviour is active. */
  version: z.string().nullable(),
  document: attentionRulesDocumentSchema.nullable(),
  diagnostics: z.array(z.object({ path: z.string(), message: z.string() })),
  /** The file on disk is invalid and the last valid document stays active. */
  retained: z.boolean(),
  /** A host read/write failure, kept apart from file diagnostics. */
  problem: z.string().nullable(),
  watcher: z.object({ status: z.enum(["watching", "unavailable"]), message: z.string().nullable() }),
  /** One-time migration result from legacy project settings; null when none existed. */
  selection: z.object({ ruleSetIds: z.array(z.string()), ticketPrefixes: z.array(z.string()) }).nullable(),
});
export type AttentionRulesState = z.infer<typeof attentionRulesStateSchema>;

export const ATTENTION_RULES_STATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS attention_rules_active (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  document TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS attention_global_selection (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  selection TEXT NOT NULL
)`,
] as const;

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type FileSnapshot = { exists: boolean; content: string | null };

export function createAttentionRulesState(
  bb: BbPluginApi,
  deps: { db: Db; onActivated?: (version: string | null) => void },
) {
  const { db } = deps;
  const host = bb.hosts.experimental_client({ contract: portScanContract, experimental_signals: attentionRulesHostSignals });
  const controller = new AbortController();
  bb.onDispose(() => controller.abort());

  let state: AttentionRulesState = {
    file: "unknown",
    version: null,
    document: null,
    diagnostics: [],
    retained: false,
    problem: null,
    watcher: { status: "unavailable", message: "Watching has not started." },
    selection: readSelection(),
  };
  const persisted = readActive();
  if (persisted) state = { ...state, document: persisted, version: rulesDocumentVersion(persisted) };
  let loaded = false;
  let hostId: string | null = null;

  function readActive(): AttentionRulesDocument | null {
    const row = db.prepare(`SELECT document FROM attention_rules_active WHERE id = 1`).get() as { document: string } | undefined;
    if (!row) return null;
    try {
      return parseAttentionRules(JSON.parse(row.document)).document;
    } catch {
      return null;
    }
  }
  function readSelection(): GlobalAttentionSelection | null {
    const row = db.prepare(`SELECT selection FROM attention_global_selection WHERE id = 1`).get() as { selection: string } | undefined;
    if (!row) return null;
    try {
      const parsed = attentionRulesStateSchema.shape.selection.parse(JSON.parse(row.selection));
      return parsed;
    } catch {
      return null;
    }
  }
  function writeActive(document: AttentionRulesDocument | null): void {
    if (document === null) {
      db.prepare(`DELETE FROM attention_rules_active WHERE id = 1`).run();
      return;
    }
    db.prepare(
      `INSERT INTO attention_rules_active (id, document) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET document = excluded.document`,
    ).run(JSON.stringify(document));
  }

  function commit(next: AttentionRulesState): AttentionRulesState {
    const versionChanged = next.version !== state.version;
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    state = next;
    if (versionChanged) deps.onActivated?.(next.version);
    // Before the first successful read no client holds a state to refresh; Settings fetches on open.
    if ((changed && loaded) || versionChanged) bb.realtime.publish(ATTENTION_RULES_CHANNEL, { version: next.version });
    return state;
  }

  /** The one validated path: watcher signals, explicit reads, and saves all end here. */
  function apply(file: FileSnapshot): AttentionRulesState {
    loaded = true;
    if (!file.exists || file.content === null) {
      writeActive(null);
      return commit({ ...state, file: "absent", version: null, document: null, diagnostics: [], retained: false, problem: null });
    }
    let json: unknown;
    try {
      json = JSON.parse(file.content);
    } catch (error) {
      return commit({
        ...state,
        file: "present",
        diagnostics: [{ path: "document", message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }],
        retained: state.document !== null,
        problem: null,
      });
    }
    const parsed = parseAttentionRules(json);
    if (!parsed.document) {
      return commit({ ...state, file: "present", diagnostics: [...parsed.diagnostics], retained: state.document !== null, problem: null });
    }
    writeActive(parsed.document);
    return commit({
      ...state,
      file: "present",
      version: rulesDocumentVersion(parsed.document),
      document: parsed.document,
      diagnostics: [...parsed.diagnostics],
      retained: false,
      problem: null,
    });
  }

  function problemOf(error: unknown): AttentionRulesState {
    return commit({ ...state, problem: error instanceof Error ? error.message : String(error) });
  }

  async function resolveHost(): Promise<string> {
    if (hostId) return hostId;
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.filter((candidate) => candidate.status === "connected").sort((a, b) => a.createdAt - b.createdAt);
    if (connected.length === 0) throw new Error("No connected host holds the attention rules file.");
    hostId = connected[0]!.id;
    return hostId;
  }

  async function call<Method extends "readAttentionRules" | "writeAttentionRules" | "installAttentionRulesExample">(
    method: Method,
    input: Method extends "readAttentionRules" ? Record<string, never> : { content: string },
  ): Promise<FileSnapshot> {
    const id = await resolveHost();
    try {
      return (await host.call(method, input as never, { hostId: id, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })) as FileSnapshot;
    } catch (error) {
      hostId = null;
      throw error;
    }
  }

  async function read(): Promise<AttentionRulesState> {
    try {
      return apply(await call("readAttentionRules", {}));
    } catch (error) {
      return problemOf(error);
    }
  }

  async function startWatch(): Promise<void> {
    try {
      const result = await host.call("watchAttentionRules", {}, { hostId: await resolveHost(), signal: controller.signal });
      commit({ ...state, watcher: result.watching
        ? { status: "watching", message: null }
        : { status: "unavailable", message: result.error ?? "The host watcher is unavailable." } });
    } catch (error) {
      commit({ ...state, watcher: { status: "unavailable", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  return {
    snapshot: (): AttentionRulesState => state,
    /** The active document, or null: the only rules input the observer sees. */
    active: (): AttentionRulesDocument | null => state.document,
    /** Subscribes to host signals and starts the directory watcher; falls back to read-on-open. */
    async start(): Promise<void> {
      host.experimental_onSignal("attentionRulesChanged", ({ payload }) => {
        apply(payload);
      });
      host.experimental_onSignal("attentionRulesWatchError", ({ payload }) => {
        commit({ ...state, watcher: { status: "unavailable", message: payload.message } });
      });
      host.experimental_onWorkerExit(() => {
        commit({ ...state, watcher: { status: "unavailable", message: "The host worker exited; reload rules to read the file." } });
      });
      await startWatch();
      await read();
    },
    /** Settings-open / sidebar-open read: free while watching, a host read otherwise. */
    async open(): Promise<AttentionRulesState> {
      if (loaded && state.watcher.status === "watching") return state;
      if (state.watcher.status !== "watching") await startWatch();
      return read();
    },
    reload: read,
    async install(): Promise<AttentionRulesState> {
      const example = attentionRulesDocumentSchema.parse(ATTENTION_RULES_EXAMPLE);
      const content = `${JSON.stringify(applyGlobalSelection(example, state.selection), null, 2)}\n`;
      try {
        return apply(await call("installAttentionRulesExample", { content }));
      } catch (error) {
        return problemOf(error);
      }
    },
    async save(content: string): Promise<AttentionRulesState> {
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch (error) {
        throw new Error(`Rules not saved: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      }
      const parsed = attentionRulesDocumentSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Rules not saved: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ")}`);
      }
      try {
        return apply(await call("writeAttentionRules", { content }));
      } catch (error) {
        return problemOf(error);
      }
    },
  };
}

/** One-time legacy migration; idempotent through the persisted selection row. */
export function migrateProjectAttention(
  db: Db,
  migrate: (rows: { presets: unknown[]; ticketPrefixes: unknown[] }[]) => GlobalAttentionSelection,
): GlobalAttentionSelection | null {
  const done = db.prepare(`SELECT selection FROM attention_global_selection WHERE id = 1`).get() as { selection: string } | undefined;
  if (done) return null;
  const rows = db.prepare(`SELECT presets, ticket_prefixes FROM project_attention`).all() as { presets: string; ticket_prefixes: string }[];
  const parse = (text: string): unknown[] => {
    try {
      const value = JSON.parse(text);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const selection = migrate(rows.map((row) => ({ presets: parse(row.presets), ticketPrefixes: parse(row.ticket_prefixes) })));
  db.prepare(`INSERT INTO attention_global_selection (id, selection) VALUES (1, ?)`).run(JSON.stringify(selection));
  db.prepare(`DELETE FROM project_attention`).run();
  return selection;
}
