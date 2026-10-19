// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrchCount, OrchLabel, OrchProgressRow } from "./OrchProgress";
import type { OrchGroupModel } from "./state";

const group: OrchGroupModel = {
  readable: true,
  groupId: "group-1",
  mtimeMs: 1,
  caller: "thr_orch",
  epic: "WS-59",
  tickets: [
    { id: "WS-1", phase: null, stopKind: null, hasQuestion: false, verification: "verified-done", threadId: null },
    { id: "WS-2", phase: "running", stopKind: null, hasQuestion: false, verification: null, threadId: null },
    { id: "WS-3", phase: "stopped", stopKind: "error", hasQuestion: false, verification: null, threadId: null },
    { id: "WS-4", phase: null, stopKind: null, hasQuestion: false, verification: null, threadId: null },
  ],
};

afterEach(cleanup);

describe("orchestrator progress components", () => {
  it("renders the epic glyph and recorded epic id", () => {
    render(<OrchLabel group={group} />);
    expect(screen.getByTestId("orch-epic-icon")).toBeTruthy();
    expect(screen.getByText("WS-59")).toBeTruthy();
  });

  it("renders the first ticket plus for a non-epic group", () => {
    render(<OrchLabel group={{ ...group, epic: null }} />);
    expect(screen.getByText("WS-1+")).toBeTruthy();
    expect(screen.queryByTestId("orch-epic-icon")).toBeNull();
  });

  it("renders coloured runs, a tick mask, summary, and count", () => {
    render(<><OrchProgressRow group={group} /><OrchCount group={group} /></>);
    const track = screen.getByTestId("orch-progress-track");
    expect(track.style.maskImage).toContain("repeating-linear-gradient");
    expect(screen.getAllByTestId("orch-progress-run")).toHaveLength(3);
    expect(screen.getByTitle("1 of 4 done · 1 failed · 1 working")).toBeTruthy();
    expect(screen.getAllByTestId("orch-progress-count")[0]?.textContent).toBe("1 / 4");
  });

  it("uses a continuous track above the tick limit", () => {
    const large = { ...group, tickets: Array.from({ length: 49 }, (_, index) => ({
      id: `WS-${index}`, phase: "running", stopKind: null, hasQuestion: false,
      verification: null, threadId: null,
    })) };
    render(<OrchProgressRow group={large} />);
    expect(screen.getByTestId("orch-progress-track").style.maskImage).toBe("");
  });
});
