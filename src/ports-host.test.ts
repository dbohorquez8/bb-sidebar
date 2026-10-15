import { existsSync } from "node:fs";
import { mkdtemp, readFile as readTextFile, rm, writeFile as writeTextFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";

const mocks = vi.hoisted(() => ({ run: vi.fn(), platform: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return { ...actual, execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.run }) };
});
vi.mock("node:os", async (importOriginal) => ({ ...await importOriginal<typeof import("node:os")>(), platform: mocks.platform }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  realpath: async (path: string) => path,
}));
import entry from "./ports-host";

const roots = [{ environmentId: "env_a", path: "/workspace/app" }];
const sockets = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 123 u 1u IPv4 0x1 0t0 TCP 127.0.0.1:3000 (LISTEN)
node 456 u 1u IPv4 0x2 0t0 TCP 127.0.0.1:4000 (LISTEN)
`;
const makeHarness = (options?: Parameters<typeof experimental_createHostEntryHarness>[1]) => experimental_createHostEntryHarness(entry, options);
let harness: ReturnType<typeof makeHarness>;

beforeEach(() => {
  mocks.run.mockReset();
  mocks.platform.mockReturnValue("darwin");
  harness = makeHarness();
});
afterEach(async () => { await harness.experimental_dispose(); });

function commands(docker: () => string = () => "") {
  mocks.run.mockImplementation(async (command: string, args: string[]) => {
    if (command === "lsof") return { stdout: args.includes("-d") ? "p123\nfcwd\nn/workspace/app\np456\nfcwd\nn/workspace/app\n" : sockets };
    if (command === "ps") return { stdout: args[0] === "eww"
      ? "node app.js BB_THREAD_ID=thr_owner PATH=/bin"
      : args.includes("lstart=") ? "Sat Oct  3 12:29:38 2026\n"
      : "123 node app.js\n456 node /opt/bb-app/server/dist/index.js" };
    if (command === "docker") return { stdout: docker() };
    throw new Error(`Unexpected command ${command}`);
  });
}

describe("host port scan", () => {
  it("enriches process listeners with Docker metadata without losing ownership or bind address", async () => {
    commands(() => "abc\tapp-web-1\t0.0.0.0:3000->3000/tcp, 0.0.0.0:8080->8080/tcp\t/workspace/app\tweb");
    const result = await harness.experimental_call("scan", { roots });
    expect(result.ports).toEqual([
      { environmentId: "env_a", port: 3000, address: "127.0.0.1", pid: 123, processName: "node", source: "process", ownerThreadId: "thr_owner", processStartedAt: "Sat Oct  3 12:29:38 2026", container: "app-web-1", service: "web" },
      { environmentId: "env_a", port: 8080, address: "0.0.0.0", source: "docker", container: "app-web-1", service: "web" },
    ]);
  });

  it("keeps user listeners and excludes BB listeners when Docker is unavailable", async () => {
    commands(() => { throw new Error("ENOENT"); });
    const result = await harness.experimental_call("scan", { roots: [...roots, { environmentId: "env_b", path: roots[0].path }] });
    expect(result.ports.map(({ environmentId, port, ownerThreadId }) => ({ environmentId, port, ownerThreadId }))).toEqual([
      { environmentId: "env_a", port: 3000, ownerThreadId: "thr_owner" },
      { environmentId: "env_b", port: 3000, ownerThreadId: "thr_owner" },
    ]);
  });

  it("propagates cancellation instead of returning a partial scan", async () => {
    const controller = new AbortController();
    commands(() => { controller.abort(); throw new Error("aborted"); });
    await expect(harness.experimental_call("scan", { roots }, { signal: controller.signal })).rejects.toThrow();
  });
});

describe("host pull request lookup", () => {
  it("reads each PR with gh and skips the ones it cannot see", async () => {
    mocks.run.mockImplementation(async (command: string, args: string[]) => {
      if (command !== "gh") throw new Error(`Unexpected command ${command}`);
      if (args[2]!.endsWith("/2")) throw new Error("Could not resolve to a PullRequest");
      return { stdout: JSON.stringify({ number: 1, title: "Fix", state: "OPEN", isDraft: true, url: "https://github.com/new/r/pull/1" }) };
    });
    const result = await harness.experimental_call("pullRequests", {
      urls: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
    });
    expect(result.pullRequests).toEqual([
      { url: "https://github.com/o/r/pull/1", number: 1, title: "Fix", state: "draft" },
    ]);
  });
});

describe("host attention rules file (persistent data directory)", () => {
  const FILE = "attention-rules.json";
  let dataDir: string;
  let listener: ((event: unknown) => void | Promise<void>) | null;
  let rules: ReturnType<typeof makeHarness>;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "rules-host-"));
    listener = null;
    rules = makeHarness({
      experimental_paths: { dataDir, tempDir: dataDir },
      experimental_watch: (_options, next) => {
        listener = next as never;
        return { dispose: async () => undefined };
      },
    });
  });
  afterEach(async () => {
    await rules.experimental_dispose();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("AC-11 — read reports an absent file and never creates it", async () => {
    await expect(rules.experimental_call("readAttentionRules", {})).resolves.toEqual({ exists: false, content: null });
    await rules.experimental_call("watchAttentionRules", {});
    expect(existsSync(join(dataDir, FILE))).toBe(false);
  });

  it("AC-01 — install writes the example once and keeps an existing file", async () => {
    const first = await rules.experimental_call("installAttentionRulesExample", { content: '{"version":1}' });
    expect(first).toEqual({ exists: true, content: '{"version":1}' });
    const second = await rules.experimental_call("installAttentionRulesExample", { content: '{"version":2}' });
    expect(second.content).toBe('{"version":1}');
    expect(await readTextFile(join(dataDir, FILE), "utf8")).toBe('{"version":1}');
  });

  it("AC-16 — a detected edit of the rules file emits its current content as a signal", async () => {
    await expect(rules.experimental_call("watchAttentionRules", {})).resolves.toEqual({ watching: true });
    await writeTextFile(join(dataDir, FILE), "edited");
    await listener!({ kind: "changed", changes: [{ path: FILE, type: "update" }] });
    await listener!({ kind: "changed", changes: [{ path: "other.txt", type: "update" }] });
    expect(rules.experimental_getSignals()).toEqual([
      { signal: "attentionRulesChanged", payload: { exists: true, content: "edited" } },
    ]);
  });

  it("AC-16 — absolute paths, a directory-level event and a rename's temp file all trigger a re-read", async () => {
    await rules.experimental_call("watchAttentionRules", {});
    await writeTextFile(join(dataDir, FILE), "abs");
    await listener!({ kind: "changed", changes: [{ path: join(dataDir, FILE), type: "update" }] });
    await writeTextFile(join(dataDir, FILE), "dir");
    await listener!({ kind: "changed", changes: [{ path: dataDir, type: "update" }] });
    await writeTextFile(join(dataDir, FILE), "renamed");
    await listener!({ kind: "changed", changes: [{ path: join(dataDir, "sedAbC123"), type: "delete" }, { path: join(dataDir, FILE), type: "create" }] });
    await writeTextFile(join(dataDir, FILE), "temp-only");
    await listener!({ kind: "changed", changes: [{ path: join(dataDir, "tmp123"), type: "delete" }] });
    await listener!({ kind: "changed", changes: [{ path: join(dataDir, "notes.txt"), type: "update" }] });
    expect(rules.experimental_getSignals().map((s) => (s.payload as { content: string }).content)).toEqual(["abs", "dir", "renamed", "temp-only"]);
  });

  it("reports a deleted rules file as absent", async () => {
    await rules.experimental_call("watchAttentionRules", {});
    await listener!({ kind: "changed", changes: [{ path: FILE, type: "delete" }] });
    expect(rules.experimental_getSignals()).toEqual([
      { signal: "attentionRulesChanged", payload: { exists: false, content: null } },
    ]);
  });

  it("signals a watcher error and reports an unavailable watcher without throwing", async () => {
    await rules.experimental_call("watchAttentionRules", {});
    await listener!({ kind: "watch-error", message: "inotify limit" });
    expect(rules.experimental_getSignals()).toEqual([
      { signal: "attentionRulesWatchError", payload: { message: "inotify limit" } },
    ]);
    const broken = makeHarness({
      experimental_paths: { dataDir, tempDir: dataDir },
      experimental_watch: () => { throw new Error("watch unavailable"); },
    });
    await expect(broken.experimental_call("watchAttentionRules", {})).resolves.toMatchObject({ watching: false });
    await broken.experimental_dispose();
    await tick();
  });
});
