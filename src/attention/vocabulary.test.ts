import { describe, expect, it } from "vitest";

import { END_WORDS, PHASE_WORDS, STATE_WORDS, effectiveKind } from "./vocabulary";

describe("effectiveKind", () => {
  it("a top-level thread keeps its file kind", () => {
    for (const kind of ["orchestrator", "implementer", "worker", "session"] as const) {
      expect(effectiveKind(kind, { isChild: false, parentKind: null })).toBe(kind);
    }
  });
  it("a top-level thread with no file is null (inference rules)", () => {
    expect(effectiveKind(null, { isChild: false, parentKind: null })).toBeNull();
  });
  it("a child implementer is a group-child under an orchestrator and under a non-orchestrator", () => {
    expect(effectiveKind("implementer", { isChild: true, parentKind: "orchestrator" })).toBe("group-child");
    expect(effectiveKind("implementer", { isChild: true, parentKind: "session" })).toBe("group-child");
    expect(effectiveKind("implementer", { isChild: true, parentKind: null })).toBe("group-child");
  });
  it("a child worker is a worker", () => {
    expect(effectiveKind("worker", { isChild: true, parentKind: "orchestrator" })).toBe("worker");
  });
  it("a child session or orchestrator keeps its kind", () => {
    expect(effectiveKind("session", { isChild: true, parentKind: "orchestrator" })).toBe("session");
    expect(effectiveKind("orchestrator", { isChild: true, parentKind: "session" })).toBe("orchestrator");
  });
  it("a child with no file is a group-child under an orchestrator, else a worker", () => {
    expect(effectiveKind(null, { isChild: true, parentKind: "orchestrator" })).toBe("group-child");
    expect(effectiveKind(null, { isChild: true, parentKind: "implementer" })).toBe("worker");
    expect(effectiveKind(null, { isChild: true, parentKind: null })).toBe("worker");
  });
});

describe("vocabulary tables", () => {
  it("worker and session have no phase words", () => {
    expect(PHASE_WORDS.worker).toEqual([]);
    expect(PHASE_WORDS.session).toEqual([]);
  });
  it("Running is an orchestrator phase only; Building is implementer and group-child only", () => {
    expect(PHASE_WORDS.orchestrator).toContain("Running");
    expect(PHASE_WORDS.implementer).not.toContain("Running");
    expect(PHASE_WORDS.orchestrator).not.toContain("Building");
    expect(PHASE_WORDS.implementer).toContain("Building");
    expect(PHASE_WORDS["group-child"]).toContain("Building");
  });
  it("Asking, Verified and Landed are group-child states; Asking is also a worker state", () => {
    expect(STATE_WORDS["group-child"]).toEqual(expect.arrayContaining(["Asking", "Verified", "Landed"]));
    expect(STATE_WORDS.worker).toEqual(["Working", "Asking", "Failed", "Done"]);
    expect(STATE_WORDS.orchestrator).not.toContain("Asking");
  });
  it("Check? and Approval are never writable states", () => {
    for (const kind of Object.keys(STATE_WORDS) as (keyof typeof STATE_WORDS)[]) {
      expect(STATE_WORDS[kind]).not.toContain("Check?");
      expect(STATE_WORDS[kind]).not.toContain("Approval");
    }
  });
  it("lists the five end words", () => {
    expect([...END_WORDS]).toEqual(["Finalized", "Stopped", "Wrapped", "Handed over", "Landed"]);
  });
});
