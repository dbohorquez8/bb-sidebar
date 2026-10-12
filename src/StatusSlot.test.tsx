// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  definePluginApp,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { idleSidebarThreadFields } from "./test-fixtures";
import { AttentionContext, type AttentionModel } from "./useAttention";
import { StatusOrTime } from "./StatusSlot";
import type { AttentionView } from "./attention";

// A one-slot harness app: a threadList whose only job is to render
// StatusOrTime for the host's first thread, always under the SAME
// AttentionContext.Provider instance (never conditionally mounted/unmounted
// — that would let React remount StatusOrTime's fiber across the switch
// below and hide the bug this test is for). Only what `viewFor` returns
// changes between renders. Registering it the same way app.tsx does keeps
// this inside the real SDK slot environment, so the fallback path's own SDK
// hook (useSidebarThreadDraft) works exactly as it does in the real sidebar.
let currentView: AttentionView | null = null;

const harnessModel: AttentionModel = {
  viewFor: () => currentView,
  isNeedsYou: () => false,
  needsYouSince: () => null,
  silenceThresholdMinutes: 15,
  chimeStatuses: new Map(),
  loadGeneration: 0,
};

function Harness(_props: PluginThreadListProps) {
  const { threads } = useSidebarThreads();
  const thread = threads[0] as PluginSidebarThread;
  return (
    <AttentionContext.Provider value={harnessModel}>
      <StatusOrTime thread={thread} now={Date.now()} />
    </AttentionContext.Provider>
  );
}

const app = await loadPluginApp(() =>
  Promise.resolve({
    default: definePluginApp((harnessApp) => {
      harnessApp.slots.experimental_threadList({
        id: "harness",
        title: "Harness",
        description: "Test harness",
        component: Harness,
      });
    }),
  }),
);
const harnessSlot = app.threadLists[0]!;

const listProps: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
};

function thread(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    ...idleSidebarThreadFields,
    id: "thr_switch",
    projectId: "proj_1",
    title: "Switching thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "runtime",
    indicatorLabel: "Thread working",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: 0,
    latestAttentionAt: 0,
    ...overrides,
  };
}

const workingView: AttentionView = {
  status: { kind: "working" },
  label: "Working",
  timeLabel: null,
  since: null,
  stage: null,
  ticket: null,
  background: { workers: 0, commands: 0, workflows: 0 },
  backgroundCount: 0,
  accessibleText: "Working",
};

describe("StatusOrTime", () => {
  it("switches between the fallback path and the attention path, and back, without a hook-order error", async () => {
    // 1. No view yet (e.g. useAttention hasn't resolved this thread): the
    //    fallback path, reading bb's own indicator through
    //    useThreadWithDraft and useWorkingSinceContext. The thread's own
    //    indicator ("runtime") renders as "Working" through that path too,
    //    so the visible text alone can't distinguish the two paths — that
    //    is the point: only the hook-order crash would tell them apart.
    currentView = null;
    const rendered = renderSlot(harnessSlot, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread()],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });
    const HarnessComponent = harnessSlot.component;
    await screen.findByText("Working");

    // 2. A view arrives for the same thread, same mounted
    //    AttentionContext.Provider, same StatusOrTime fiber: the
    //    attention path takes over. If StatusOrTime calls a different
    //    number of hooks on this side of the branch than the fallback
    //    side, React throws "Rendered more hooks than during the previous
    //    render" here, failing the test before the assertion runs.
    currentView = workingView;
    rendered.rerender(<HarnessComponent {...listProps} />);
    await screen.findByText("Working");

    // 3. The view disappears again (e.g. the thread drops out of
    //    useAttention's resolved map): back to the fallback path, same
    //    fiber once more.
    currentView = null;
    rendered.rerender(<HarnessComponent {...listProps} />);
    await screen.findByText("Working");

    cleanup();
  });
});
