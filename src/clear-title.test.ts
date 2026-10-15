import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import {
  CLEAR_RETITLE_MIGRATION,
  createClearRetitle,
  isContinuationPrompt,
  pendingClearRetitle,
} from "./clear-title";

const disposers: Array<() => Promise<void>> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()));
  vi.useRealTimers();
});

type Row = { seq: number; type: string; data: unknown };

function clear(seq: number, operationId: string | null = `op-${seq}`): Row {
  return { seq, type: "system/operation", data: { operation: "context_clear", status: "completed", operationId } };
}

function prompt(seq: number, text: string, initiator = "user"): Row {
  return { seq, type: "client/turn/requested", data: { initiator, input: [{ type: "text", text }] } };
}

function setup(initialRows: Row[] = []) {
  const { bb, harness } = createFakePluginHost({ pluginId: "bb-sidebar" });
  bb.storage.migrate(bb.storage.database(), [CLEAR_RETITLE_MIGRATION]);
  let rows = initialRows;
  let thread = makeThreadResponse({ id: "target", title: "WS-70: old work", visibility: "visible" });
  const list = async () => [...rows].sort((a, b) => b.seq - a.seq);
  harness.inspection.sdk.stub("threads.events.list", list);
  const regenerate = vi.fn(async () => ({ title: "New work" }));
  createClearRetitle(bb, regenerate);
  disposers.push(() => harness.lifecycle.dispose());
  return {
    harness, regenerate, list,
    setRows: (next: Row[]) => { rows = next; },
    setThread: (changes: Partial<typeof thread>) => { thread = { ...thread, ...changes }; },
    active: () => harness.behavior.emitThreadEvent("thread.active", { thread }),
  };
}

describe("continuation prompts", () => {
  it("recognizes resume commands and phrases, case-insensitively", () => {
    for (const text of ["/catchup", "/workflow:catchup WS-70", "/implement WS-71", "Continue", "  keep going", "Pick up where I left off"])
      expect(isContinuationPrompt(text), text).toBe(true);
    for (const text of ["/daos:update", "/ws-status", "/catchups", "/implement-plan", "Continuous integration is broken", "Fix the sidebar title", "Can we continue the review later?"])
      expect(isContinuationPrompt(text), text).toBe(false);
  });
});

describe("pending clear retitle", () => {
  it("returns the clear and the single user prompt after it", () => {
    expect(pendingClearRetitle([prompt(5, "Fix titles"), clear(3), prompt(1, "old")]))
      .toEqual({ clearKey: "op-3", text: "Fix titles" });
  });

  it("ignores prompts not sent by the user and falls back to the row seq", () => {
    expect(pendingClearRetitle([prompt(6, "from agent", "agent"), prompt(5, "Fix titles"), clear(3, null)]))
      .toEqual({ clearKey: "seq:3", text: "Fix titles" });
  });

  it("returns nothing without a clear, before any prompt, or after a second prompt", () => {
    expect(pendingClearRetitle([prompt(2, "a"), prompt(1, "b")])).toBeNull();
    expect(pendingClearRetitle([clear(3), prompt(1, "old")])).toBe("waiting");
    expect(pendingClearRetitle([prompt(4, "/clear"), clear(3)])).toBe("waiting");
    expect(pendingClearRetitle([prompt(6, "second"), prompt(5, "first"), clear(3)])).toBeNull();
  });
});

describe("retitle after /clear", () => {
  it("renames once from the first new-work prompt only, even after a reload", async () => {
    const reloaded = vi.fn(async () => ({ title: "Again" }));
    const state = setup([prompt(1, "old work"), clear(3), prompt(5, "Make the thread title follow /clear")]);
    await state.active();
    expect(state.regenerate).toHaveBeenCalledExactlyOnceWith("target", { messages: ["Make the thread title follow /clear"] });
    await state.active();
    const replacement = await state.harness.lifecycle.reload(bb => createClearRetitle(bb, reloaded));
    disposers.push(() => replacement.harness.lifecycle.dispose());
    replacement.harness.inspection.sdk.stub("threads.events.list", state.list);
    await replacement.harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "target", title: "New work", visibility: "visible" }),
    });
    expect(replacement.harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(1);
    expect(reloaded).not.toHaveBeenCalled();
    expect(state.regenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the title for a continuation prompt and for every prompt after it", async () => {
    const state = setup([clear(3), prompt(5, "/workflow:catchup")]);
    await state.active();
    state.setRows([clear(3), prompt(5, "/workflow:catchup"), prompt(7, "Now do something new")]);
    await state.active();
    expect(state.regenerate).not.toHaveBeenCalled();
  });

  it("renames again after a later clear", async () => {
    const state = setup([clear(3), prompt(5, "First task")]);
    await state.active();
    state.setRows([clear(3), prompt(5, "First task"), clear(8), prompt(9, "Second task")]);
    await state.active();
    expect(state.regenerate.mock.calls).toEqual([
      ["target", { messages: ["First task"] }],
      ["target", { messages: ["Second task"] }],
    ]);
  });

  it("looks again when the turn starts before its prompt is recorded", async () => {
    const state = setup([prompt(1, "old"), clear(3)]);
    await state.active();
    expect(state.regenerate).not.toHaveBeenCalled();
    state.setRows([prompt(1, "old"), clear(3), prompt(5, "New task")]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.regenerate).toHaveBeenCalledExactlyOnceWith("target", { messages: ["New task"] });
  });

  it("stops looking after two retries", async () => {
    const state = setup([clear(3)]);
    await state.active();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(3);
    expect(state.regenerate).not.toHaveBeenCalled();
  });

  it("forgets a deleted thread's handled clears", async () => {
    const state = setup([clear(3), prompt(5, "New task")]);
    await state.active();
    await state.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "target" }),
    });
    await state.active();
    expect(state.regenerate).toHaveBeenCalledTimes(2);
  });

  it("skips untitled, hidden, archived, and deleted threads", async () => {
    const state = setup([clear(3), prompt(5, "New task")]);
    for (const changes of [{ title: null }, { visibility: "hidden" as const }, { archivedAt: 1 }, { deletedAt: 1 }]) {
      state.setThread({ title: "Old", visibility: "visible", archivedAt: null, deletedAt: null, ...changes });
      await state.active();
    }
    expect(state.regenerate).not.toHaveBeenCalled();
    expect(state.harness.inspection.sdk.callsTo("threads.events.list")).toHaveLength(0);
  });

  it("logs a generator failure instead of throwing, and does not retry it", async () => {
    const state = setup([clear(3), prompt(5, "New task")]);
    state.regenerate.mockRejectedValueOnce(new Error("Thread titles are turned off in Settings → AI services"));
    await state.active();
    await state.active();
    expect(state.regenerate).toHaveBeenCalledTimes(1);
    expect(state.harness.inspection.logEntries).toContainEqual(expect.objectContaining({
      level: "info", message: expect.stringContaining("Thread titles are turned off"),
    }));
  });
});
