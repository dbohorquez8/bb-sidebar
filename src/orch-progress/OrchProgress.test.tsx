// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrchCount, OrchLabel, OrchTitleRow } from "./OrchProgress";
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

describe("orchestrator title row components", () => {
  it("renders the epic glyph and recorded epic id", () => {
    render(<OrchLabel group={group} />);
    expect(screen.getByTestId("orch-epic-icon")).toBeTruthy();
    expect(screen.getByText("WS-59")).toBeTruthy();
  });

  it("renders no label for a group without an epic", () => {
    const { container } = render(<OrchLabel group={{ ...group, epic: null }} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders one coloured chip per ticket in full mode with the count, and a worded label per chip", () => {
    render(<OrchTitleRow group={group} />);
    const chips = document.querySelectorAll("[data-orch-chip]");
    expect([...chips].map((chip) => chip.textContent)).toEqual(["WS-1", "WS-2", "WS-3", "WS-4"]);
    expect([...chips].map((chip) => chip.getAttribute("data-orch-kind"))).toEqual(["done", "working", "failed", "queued"]);
    expect(screen.getByLabelText("WS-3: Failed")).toBeTruthy();
    expect(screen.getByTitle("1 of 4 done · 1 failed · 1 working")).toBeTruthy();
    expect(screen.getByTestId("orch-progress-count").textContent).toBe("1 / 4");
  });

  it("shows no epic chip and no 'first id +' for a plain ticket group", () => {
    render(<OrchTitleRow group={{ ...group, epic: null }} />);
    expect(document.querySelector("[data-orch-label]")).toBeNull();
    expect(screen.queryByText("WS-1+")).toBeNull();
    expect(document.querySelectorAll("[data-orch-chip]")).toHaveLength(4);
  });

  it("puts the epic chip before the first ticket", () => {
    render(<OrchTitleRow group={group} />);
    const epic = document.querySelector("[data-orch-label]")!;
    const first = document.querySelector("[data-orch-chip]")!;
    expect(epic.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("falls back to ticks for a long list when nothing is measured, one tick per ticket", () => {
    const large = { ...group, tickets: Array.from({ length: 49 }, (_, index) => ({
      id: `WS-${index}`, phase: "running", stopKind: null, hasQuestion: false,
      verification: null, threadId: null,
    })) };
    render(<OrchTitleRow group={large} />);
    expect(document.querySelectorAll("[data-orch-tick]")).toHaveLength(49);
    expect(document.querySelectorAll("[data-orch-chip]")).toHaveLength(0);
  });

  it("renders the compact count alone", () => {
    render(<OrchCount group={group} />);
    expect(screen.getByTestId("orch-progress-count").textContent).toBe("1 / 4");
  });
});
