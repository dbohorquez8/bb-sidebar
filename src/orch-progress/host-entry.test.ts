import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../ports-host";

describe("host entry: readOrchestratorGroups", () => {
  let state: string;
  const saved = process.env.ORCHESTRATE_STATE_DIR;
  const harness = experimental_createHostEntryHarness(entry);
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), "orch-host-"));
    process.env.ORCHESTRATE_STATE_DIR = state;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ORCHESTRATE_STATE_DIR; else process.env.ORCHESTRATE_STATE_DIR = saved;
    rmSync(state, { recursive: true, force: true });
  });

  it("returns the reduced groups through the host contract", async () => {
    mkdirSync(join(state, "groups", "group-1"), { recursive: true });
    writeFileSync(
      join(state, "groups", "group-1", "ledger.md"),
      `<!-- orchestrate-ledger-json\n${JSON.stringify({ caller: "thr_a", tickets: ["WS-1"], state: { "WS-1": { phase: "running" } } })}\n-->\n`,
    );
    const result = await harness.experimental_call("readOrchestratorGroups", {});
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ readable: true, groupId: "group-1", caller: "thr_a", epic: null });
  });

  it("returns an empty list when the machine has no groups", async () => {
    expect(await harness.experimental_call("readOrchestratorGroups", {})).toEqual({ groups: [] });
  });
});
