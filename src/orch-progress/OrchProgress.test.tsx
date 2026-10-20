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

  it("chains one status-coloured tick per ticket showing only its number, with the count and a worded label per tick", () => {
    render(<OrchTitleRow group={group} />);
    const ticks = document.querySelectorAll("[data-orch-tick]");
    expect([...ticks].map((tick) => tick.textContent)).toEqual(["1", "2", "3", "4"]);
    expect([...ticks].map((tick) => tick.getAttribute("data-orch-kind"))).toEqual(["done", "in-progress", "in-progress", "ready"]);
    expect(screen.getByLabelText("WS-3: In Progress · failed: error")).toBeTruthy();
    expect(screen.getByTitle("1 of 4 done · 2 in progress · 1 ready")).toBeTruthy();
    expect(screen.getByTestId("orch-progress-count").textContent).toBe("1 / 4");
  });

  it("leads with the project code when there is no epic, and never a 'first id +' label", () => {
    render(<OrchTitleRow group={{ ...group, epic: null }} />);
    expect(document.querySelector("[data-orch-label]")?.textContent).toBe("WS");
    expect(screen.queryByText("WS-1+")).toBeNull();
    expect(document.querySelectorAll("[data-orch-tick]")).toHaveLength(4);
  });

  it("puts the first tick before the ticket ticks", () => {
    render(<OrchTitleRow group={group} />);
    const first = document.querySelector("[data-orch-label]")!;
    const next = document.querySelector("[data-orch-tick]")!;
    expect(first.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("narrows a long unmeasured list, one empty tick per ticket", () => {
    const large = { ...group, tickets: Array.from({ length: 49 }, (_, index) => ({
      id: `WS-${index}`, phase: "running", stopKind: null, hasQuestion: false,
      verification: null, threadId: null,
    })) };
    render(<OrchTitleRow group={large} />);
    const ticks = [...document.querySelectorAll("[data-orch-tick]")];
    expect(ticks).toHaveLength(49);
    expect(ticks.every((tick) => tick.getAttribute("data-orch-form") === "narrow" && tick.textContent === "")).toBe(true);
  });

  it("renders the compact count alone", () => {
    render(<OrchCount group={group} />);
    expect(screen.getByTestId("orch-progress-count").textContent).toBe("1 / 4");
  });
});
