import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_RULES_CHANNEL,
  splitPrefixInput,
  validateSilenceThreshold,
  type AttentionRulesDocument,
  type AttentionRuleSet,
} from "./attention";
import type { AttentionRulesState } from "./attention-rules-state";
import { SettingRow, SettingsGroup, Switch } from "./settings-ui";

const BUTTON =
  "rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const serialize = (document: AttentionRulesDocument): string => `${JSON.stringify(document, null, 2)}\n`;

/**
 * "After [15] minutes of silence", refusing anything `validateSilenceThreshold`
 * refuses. No SDK hook: a plain controlled field, directly Component-testable.
 */
export function SilenceThresholdField({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>After</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Silence threshold"
          aria-invalid={error !== null}
          aria-describedby={error ? "silence-threshold-error" : undefined}
          value={minutes}
          onChange={(event) => {
            const result = validateSilenceThreshold(event.target.value);
            if (result.ok) {
              setError(null);
              onChange(result.minutes);
            } else {
              setError(result.reason);
            }
          }}
          className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
        />
        <span>minutes of silence</span>
      </div>
      {error ? (
        <p id="silence-threshold-error" className="mt-1 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One rule set: accessible on/off switch plus an inline editor that shows the edited JSON before save. */
export function RuleSetRow({
  set,
  onToggle,
  onSave,
}: {
  set: AttentionRuleSet;
  onToggle: (enabled: boolean) => void;
  onSave: (next: AttentionRuleSet) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(JSON.stringify(set, null, 2));
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (cause) {
      setError(`Invalid JSON: ${errorText(cause)}`);
      return;
    }
    const failure = await onSave(parsed as AttentionRuleSet);
    if (failure) setError(failure);
    else setEditing(false);
  };
  const counts = [
    [set.replyMarkers.length, "reply markers"],
    [set.skillStatuses.length, "skill statuses"],
    [set.skillLabels.length, "skill labels"],
    [set.labelResets.length, "label resets"],
  ] as const;

  return (
    <li>
      <SettingRow
        title={set.label}
        description={counts.filter(([count]) => count > 0).map(([count, name]) => `${count} ${name}`).join(", ") || "No rules"}
        control={
          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON} aria-expanded={editing} onClick={editing ? () => setEditing(false) : open}>
              {editing ? "Close" : `Edit ${set.label}`}
            </button>
            <Switch label={set.label} checked={set.enabled} onChange={onToggle} />
          </div>
        }
      />
      {editing ? (
        <div className="px-4 pb-3">
          <textarea
            aria-label={`${set.label} rule set JSON`}
            aria-invalid={error !== null}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          />
          {error ? <p role="alert" className="mt-1 text-2xs text-destructive">{error}</p> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className={BUTTON} onClick={() => void save()}>
              Save rule set
            </button>
            <button type="button" className={BUTTON} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Global ticket prefixes, committed on blur or Enter as one whole-document save. */
export function TicketPrefixField({
  prefixes,
  onCommit,
}: {
  prefixes: readonly string[];
  onCommit: (prefixes: string[]) => Promise<string | null>;
}) {
  const stored = prefixes.join(", ");
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const commit = async () => {
    const next = splitPrefixInput(draft);
    if (next.join(", ") === stored) {
      setError(null);
      return;
    }
    setError(await onCommit(next));
  };

  return (
    <SettingRow title="Ticket prefixes" description="Comma-separated, for example WS-, AID-. Applied to every project.">
      <input
        type="text"
        aria-label="Ticket prefixes"
        aria-invalid={error !== null}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
        }}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
      />
      {error ? <p role="alert" className="mt-1 text-2xs text-destructive">{error}</p> : null}
    </SettingRow>
  );
}

/**
 * The sidebar-wide silence threshold and the global attention rules. Rules live
 * in one file owned by the host; every read, install, reload, and save goes
 * through the server's rules RPCs, and the global channel refreshes this view
 * after a hand edit. Opening or reloading never installs the example.
 */
export function AttentionSettings({
  silenceThresholdMinutes,
  onSilenceThresholdChange,
}: {
  silenceThresholdMinutes: number;
  onSilenceThresholdChange: (minutes: number) => void;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [state, setState] = useState<AttentionRulesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (call: () => Promise<AttentionRulesState>): Promise<AttentionRulesState | null> => {
      try {
        const next = await call();
        if (mounted.current) {
          setState(next);
          setLoadError(null);
        }
        return next;
      } catch (error) {
        if (mounted.current) setLoadError(errorText(error));
        return null;
      }
    },
    [],
  );

  const load = useCallback(() => run(() => rpc.call("getAttentionRules", {})), [rpc, run]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(ATTENTION_RULES_CHANNEL, () => {
    void load();
  });

  const reload = async () => {
    setBusy(true);
    setNotice(null);
    const next = await run(() => rpc.call("reloadAttentionRules", {}));
    setBusy(false);
    if (next) setNotice(next.file === "absent" ? "Reloaded: no rules file yet." : next.retained ? "Reloaded: the file is invalid; the last valid rules stay active." : "Rules reloaded.");
  };

  const install = async () => {
    setBusy(true);
    setNotice(null);
    const next = await run(() => rpc.call("installAttentionRulesExample", {}));
    setBusy(false);
    if (next) setNotice("Example rules installed.");
  };

  /** Saves the complete document; resolves to an error message, or null on success. */
  const saveDocument = async (document: AttentionRulesDocument): Promise<string | null> => {
    try {
      const next = await rpc.call("saveAttentionRules", { content: serialize(document) });
      if (mounted.current) {
        setState(next);
        setLoadError(null);
        setNotice(null);
      }
      return null;
    } catch (error) {
      return errorText(error);
    }
  };

  const document = state?.document ?? null;
  const reportSaveFailure = async (document_: AttentionRulesDocument) => {
    const failure = await saveDocument(document_);
    if (failure) setLoadError(failure);
  };
  const showWatcherFallback = state !== null && state.watcher.status === "unavailable";

  return (
    <>
      <SettingRow title="Silence threshold" description="Minutes of silent background work before a card turns Check?.">
        <SilenceThresholdField minutes={silenceThresholdMinutes} onChange={onSilenceThresholdChange} />
      </SettingRow>
      <SettingsGroup title="Attention rules">
        {state === null && loadError === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading rules...</p>
        ) : null}
        {loadError ? (
          <p role="alert" className="px-4 py-2.5 text-xs text-destructive">
            {loadError}
          </p>
        ) : null}
        {state?.problem ? (
          <p role="alert" className="px-4 py-2.5 text-xs text-destructive">
            Could not reach the rules file: {state.problem}
          </p>
        ) : null}
        {showWatcherFallback ? (
          <p role="status" className="px-4 py-2.5 text-xs text-muted-foreground">
            Automatic reload is off ({state.watcher.message ?? "the host watcher is unavailable"}). Use Reload rules after editing the file.
          </p>
        ) : null}
        {state && state.diagnostics.length > 0 ? (
          <div role="alert" className="px-4 py-2.5">
            <p className="text-xs text-destructive">
              {state.retained
                ? "The rules file is invalid. The last valid rules stay active."
                : document
                  ? "Some rules in the file are not applied."
                  : "The rules file is invalid. No custom rules are active."}
            </p>
            <ul className="mt-1 list-disc pl-4 text-2xs text-destructive">
              {state.diagnostics.map((item, index) => (
                <li key={`${item.path}-${index}`}>
                  {item.path}: {item.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {state?.file === "absent" ? (
          <div className="px-4 py-2.5">
            <p className="text-sm text-foreground">No rules file yet.</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Without one, cards use only BB's own status. Install the example rules, then edit them here or in the file.
            </p>
            <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => void install()}>
              Install example rules
            </button>
          </div>
        ) : null}
        {document ? (
          <>
            <ul aria-label="Rule sets">
              {document.ruleSets.map((set) => (
                <RuleSetRow
                  key={set.id}
                  set={set}
                  onToggle={(enabled) =>
                    void reportSaveFailure({
                      ...document,
                      ruleSets: document.ruleSets.map((candidate) => (candidate.id === set.id ? { ...candidate, enabled } : candidate)),
                    })
                  }
                  onSave={(next) =>
                    saveDocument({
                      ...document,
                      ruleSets: document.ruleSets.map((candidate) => (candidate.id === set.id ? next : candidate)),
                    })
                  }
                />
              ))}
            </ul>
            <TicketPrefixField prefixes={document.ticketPrefixes} onCommit={(ticketPrefixes) => saveDocument({ ...document, ticketPrefixes })} />
          </>
        ) : null}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void reload()}>
            Reload rules
          </button>
          {notice ? (
            <span role="status" className="text-xs text-muted-foreground">
              {notice}
            </span>
          ) : null}
        </div>
      </SettingsGroup>
    </>
  );
}
