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
import type { CardView } from "./attention/card-view";

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
  silenceThresholdMinutes: 40, // WS-268 AC-60: the default threshold is 40
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

const idleCard: CardView = {
  word: null, count: null, text: null, tone: null, icon: "none", pill: false, hint: null, bar: null, timeLabel: null, phase: null,
};
const cardOf = (overrides: Partial<CardView>): CardView => ({ ...idleCard, ...overrides });
const workingCard = cardOf({ word: "Working", text: "Working", tone: "yellow", icon: "spinner" });

const workingView: AttentionView = {
  status: { kind: "working" },
  label: "Working",
  timeLabel: null,
  since: null,
  ruleLabel: null,
  ticket: null,
  background: { workers: 0, commands: 0, workflows: 0 },
  backgroundCount: 0,
  accessibleText: "Working",
  card: workingCard,
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

  // WS-268 AC-15: the phase word carries the file's count ("Building 2 / 5"); the slot renders view.card.
  const renderView = async (view: AttentionView) => {
    currentView = view;
    const rendered = renderSlot(harnessSlot, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread()],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" }],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });
    return rendered;
  };

  it("shows 'Building 2 / 5' with the time while Working (AC-15, was AC-65)", async () => {
    await renderView({
      ...workingView,
      card: cardOf({ word: "Building", count: "2 / 5", text: "Building 2 / 5", tone: "yellow", icon: "spinner", timeLabel: "3m" }),
      timeLabel: "3m",
    });
    expect(await screen.findByText("Building 2 / 5")).toBeTruthy();
    expect(screen.getByText("3m")).toBeTruthy();
    cleanup();
  });

  it("shows plain 'Building' when no count is known (AC-15, was AC-66)", async () => {
    await renderView({
      ...workingView,
      card: cardOf({ word: "Building", text: "Building", tone: "yellow", icon: "spinner" }),
    });
    expect(await screen.findByText("Building")).toBeTruthy();
    expect(screen.queryByText(/Building \d/)).toBeNull();
    cleanup();
  });

  it("shows no stage or count for Needs you and Done (AC-25, AC-37)", async () => {
    await renderView({
      ...workingView,
      status: { kind: "needs-you" },
      label: "Needs you",
      card: cardOf({ word: "Needs you", text: "Needs you", tone: "red", icon: "bell", pill: true }),
    });
    expect(await screen.findByText("Needs you")).toBeTruthy();
    expect(screen.queryByText(/Building/)).toBeNull();
    cleanup();
    await renderView({
      ...workingView,
      status: { kind: "done" },
      label: "Done",
      card: cardOf({ word: "Done", text: "Done", tone: "white", icon: "check-in-circle", pill: true }),
    });
    expect(await screen.findByText("Done")).toBeTruthy();
    expect(screen.queryByText(/Building/)).toBeNull();
    cleanup();
  });

  // WS-268 AC-31: Finalized is violet text with a rocket and no pill background (was WS-206's flag).
  it("shows Finalized as violet text with a rocket and no pill fill (AC-31)", async () => {
    const { container } = await renderView({
      ...workingView,
      status: { kind: "finalized" },
      label: "Finalized",
      card: cardOf({ word: "Finalized", text: "Finalized", tone: "violet", icon: "rocket" }),
    });
    const label = await screen.findByText("Finalized");
    const root = label.parentElement as HTMLElement;
    expect(root.className).toContain("--bb-sidebar-status-finalized");
    expect(root.className).not.toContain("pill-finalized");
    expect(root.className).not.toContain("rounded-full");
    expect(root.className).not.toMatch(/\bbg-/);
    expect(container.querySelector('svg[data-icon="Rocket"]')).toBeTruthy();
    cleanup();
  });

  // WS-268 AC-71: a rule label never renders on a card, with or without a tone (was WS-67 AC-27, AC-30, AC-32).
  it("never shows a rule label, toned or not, while Working (AC-71)", async () => {
    await renderView({ ...workingView, ruleLabel: { text: "Finalizing", tone: "success" } });
    expect(await screen.findByText("Working")).toBeTruthy();
    expect(screen.queryByText("Finalizing")).toBeNull();
    cleanup();
    await renderView({ ...workingView, ruleLabel: { text: "Finalizing" } });
    expect(await screen.findByText("Working")).toBeTruthy();
    expect(screen.queryByText("Finalizing")).toBeNull();
    cleanup();
  });

  it("never shows a rule label over Needs you (AC-71)", async () => {
    await renderView({
      ...workingView,
      status: { kind: "needs-you" },
      label: "Needs you",
      ruleLabel: { text: "Finalizing", tone: "danger" },
      card: cardOf({ word: "Needs you", text: "Needs you", tone: "red", icon: "bell", pill: true }),
    });
    expect(await screen.findByText("Needs you")).toBeTruthy();
    expect(screen.queryByText("Finalizing")).toBeNull();
    cleanup();
  });
});
