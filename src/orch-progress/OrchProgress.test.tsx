// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrchLabel, OrchTitleRow } from "./OrchProgress";
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

  it("renders the project code, no glyph, as the first tick of a group without an epic", () => {
    render(<OrchLabel group={{ ...group, epic: null }} />);
    expect(screen.getByText("WS")).toBeTruthy();
    expect(screen.queryByTestId("orch-epic-icon")).toBeNull();
  });

  it("renders no label when the tickets mix prefixes and there is no epic", () => {
    const mixed = { ...group, epic: null, tickets: [group.tickets[0]!, { ...group.tickets[1]!, id: "AID-2" }] };
    const { container } = render(<OrchLabel group={mixed} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws one text-free segment per ticket, with the done / total count beside the bar and the summary as the only label", () => {
    render(<OrchTitleRow group={group} />);
    const ticks = document.querySelectorAll("[data-orch-tick]");
    expect([...ticks].map((tick) => tick.textContent)).toEqual(["", "", "", ""]);
    expect([...ticks].map((tick) => tick.getAttribute("data-orch-kind"))).toEqual(["done", "in-progress", "in-progress", "ready"]);
    expect(screen.getByLabelText("Orchestrator progress: 1 of 4 done · 2 in progress · 1 ready")).toBeTruthy();
    expect(screen.getByTestId("orch-progress-count").textContent).toBe("1 / 4");
  });

  it("carries no native title anywhere in the strip, so only the one summary tooltip can show", () => {
    const { container } = render(<OrchTitleRow group={group} />);
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("leads with the project code when there is no epic", () => {
    render(<OrchTitleRow group={{ ...group, epic: null }} />);
    expect(document.querySelector("[data-orch-label]")?.textContent).toBe("WS");
    expect(document.querySelectorAll("[data-orch-tick]")).toHaveLength(4);
  });

  it("puts the chip first, then the thread title, then the bar and the count at the right edge", () => {
    render(<OrchTitleRow group={group}><span data-testid="title">Orch: epic</span></OrchTitleRow>);
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(document.querySelector("[data-orch-label]")!, screen.getByTestId("title"))).toBe(true);
    expect(follows(screen.getByTestId("title"), screen.getByTestId("orch-bar"))).toBe(true);
    expect(follows(screen.getByTestId("orch-bar"), screen.getByTestId("orch-progress-count"))).toBe(true);
  });

  it("keeps one segment per ticket for a very long list", () => {
    const large = { ...group, tickets: Array.from({ length: 49 }, (_, index) => ({
      id: `WS-${index}`, phase: "running", stopKind: null, hasQuestion: false,
      verification: null, threadId: null,
    })) };
    render(<OrchTitleRow group={large} />);
    expect(document.querySelectorAll("[data-orch-tick]")).toHaveLength(49);
  });
});
