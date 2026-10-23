import { describe, expect, it } from "vitest";
import { hideChildrenOfVisibleParents } from "./inbox";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { missingParentIds, nestThroughHiddenParents } from "./hidden-parents";

const link = (id: string, parentThreadId: string | null) => ({ id, parentThreadId });

describe("nestThroughHiddenParents", () => {
  it("points a child of a hidden thread at the listed grandparent", () => {
    const threads = [link("R", null), link("S", "H")];
    const nested = nestThroughHiddenParents(threads, { H: "R" });
    expect(nested.find((thread) => thread.id === "S")?.parentThreadId).toBe("R");
    const flat = hideChildrenOfVisibleParents(nested as unknown as PluginSidebarThread[]);
    expect(flat.map((thread) => thread.id)).toEqual(["R"]);
  });

  it("walks a chain of several hidden threads", () => {
    const threads = [link("R", null), link("S", "H1")];
    const nested = nestThroughHiddenParents(threads, { H1: "H2", H2: "R" });
    expect(nested[1]!.parentThreadId).toBe("R");
  });

  it.each([
    ["the chain ends at a root", { H: null }],
    ["the hidden thread is unknown", {}],
    ["the ancestor is not listed", { H: "X" }],
    ["the chain loops", { H: "H2", H2: "H" }],
  ])("keeps the original parent when %s", (_case, hiddenParents) => {
    const threads = [link("R", null), link("S", "H")];
    expect(nestThroughHiddenParents(threads, hiddenParents)).toBe(threads);
  });

  it("returns threads with a listed or null parent unchanged", () => {
    const threads = [link("R", null), link("C", "R"), link("S", "H")];
    const nested = nestThroughHiddenParents(threads, { H: "R" });
    expect(nested[0]).toBe(threads[0]);
    expect(nested[1]).toBe(threads[1]);
  });
});

describe("missingParentIds", () => {
  it("lists unlisted parent ids once, sorted", () => {
    const threads = [link("R", null), link("A", "R"), link("B", "Z"), link("C", "H"), link("D", "H")];
    expect(missingParentIds(threads)).toEqual(["H", "Z"]);
  });
});
