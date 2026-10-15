import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { resolveAttentionStatus } from "./attention/status";
import { attentionInputFromThread } from "./attention-thread-input";
import { reconcileFailedAck } from "./attention/since";
import { childStatusKind, childStatusSummary } from "./child-status";
import { collapsedChildThreads } from "./ChildThreadList";
import {
  CHILD_FAILURE_WINDOW_MS,
  childFailureReported,
  type ChildFailureContext,
} from "./child-failure";
import { idleSidebarThreadFields } from "./test-fixtures";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function child(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    ...idleSidebarThreadFields,
    id: "thr_child",
    projectId: "proj_1",
    title: "A child",
    titleFallback: null,
    parentThreadId: "thr_parent",
    providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    createdAt: 0,
    status: "error",
    updatedAt: NOW - DAY,
    ...overrides,
  } as PluginSidebarThread;
}

const open: ChildFailureContext = { parentOpen: true, acknowledged: false, now: NOW };

describe("childFailureReported (WS-51)", () => {
  it("shows a recent unread error under an open parent", () => {
    expect(childFailureReported(child(), open)).toBe(true);
  });
  it("needs status error", () => {
    expect(childFailureReported(child({ status: "idle" } as never), open)).toBe(false);
  });
  it("stays quiet for an archived child", () => {
    expect(childFailureReported(child({ isArchived: true }), open)).toBe(false);
  });
  it("stays quiet when the parent is archived or missing", () => {
    expect(childFailureReported(child(), { ...open, parentOpen: false })).toBe(false);
  });
  it("stays quiet once acknowledged", () => {
    expect(childFailureReported(child(), { ...open, acknowledged: true })).toBe(false);
  });
  it("stays quiet for an 8-day-old failure and keeps the 7-day edge", () => {
    expect(childFailureReported(child({ updatedAt: NOW - 8 * DAY }), open)).toBe(false);
    expect(childFailureReported(child({ updatedAt: NOW - CHILD_FAILURE_WINDOW_MS }), open)).toBe(true);
  });
  it("ignores a top-level thread", () => {
    expect(childFailureReported(child({ parentThreadId: null }), open)).toBe(false);
  });
});

describe("wiring", () => {
  const ctx = { verdict: null, silent: false, onInactiveShelf: false, failureAcknowledged: false };
  const status = (t: PluginSidebarThread, extra = {}) =>
    resolveAttentionStatus(attentionInputFromThread(t, {
      ...ctx,
      parentOpen: true,
      now: NOW,
      ...extra,
    })).kind;

  it("resolves Failed for a recent unread child error", () => {
    expect(status(child())).toBe("failed");
  });
  it("stays quiet under an archived or missing parent, when old, or without a clock", () => {
    expect(status(child(), { parentOpen: false })).not.toBe("failed");
    expect(status(child({ updatedAt: NOW - 8 * DAY }))).not.toBe("failed");
    expect(
      resolveAttentionStatus(attentionInputFromThread(child(), ctx)).kind,
    ).not.toBe("failed");
  });
  it("opening the failing child clears it", () => {
    const failing = new Set(["thr_child"]);
    const ack = reconcileFailedAck(new Set(), failing, "thr_child", null);
    expect(ack.has("thr_child")).toBe(true);
    expect(status(child(), { failureAcknowledged: ack.has("thr_child") })).not.toBe("failed");
  });
  it("childStatusKind and the summary count it only when given the rule's context", () => {
    expect(childStatusKind(child())).toBeNull();
    expect(childStatusKind(child(), null, open)).toBe("failed");
    expect(childStatusKind(child(), null, { ...open, parentOpen: false })).toBeNull();
    const summary = childStatusSummary([child()], () => ({ status: { kind: "failed" } }) as never);
    expect(summary.failed).toBe(1);
  });
  it("retains a WS-51 failure in a collapsed list through its attention view", () => {
    const childThread = child();
    const children = new Map<string, readonly PluginSidebarThread[]>([
      ["thr_parent", [childThread]],
    ]);
    const failedView = { status: { kind: "failed" } } as never;
    expect(collapsedChildThreads([childThread], children, null, true)).toEqual([]);
    expect(
      collapsedChildThreads([childThread], children, null, true, () => failedView),
    ).toEqual([childThread]);
  });
});
