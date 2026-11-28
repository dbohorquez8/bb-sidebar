import { describe, expect, it } from "vitest";

import { isMissingFile } from "./status-reader";

describe("isMissingFile (D-8 (e): a missing file never counts as failed)", () => {
  it("treats the SDK's HTTP 404 missing-path error as missing", () => {
    expect(isMissingFile(new Error("HTTP 404: Path does not exist: /x/.claude/status/thr_a.md"))).toBe(true);
    expect(isMissingFile({ status: 404 })).toBe(true);
    expect(isMissingFile({ statusCode: 404 })).toBe(true);
  });
  it("keeps the ENOENT cases", () => {
    expect(isMissingFile({ code: "ENOENT" })).toBe(true);
    expect(isMissingFile(new Error("ENOENT: no such file or directory"))).toBe(true);
  });
  it("still counts any other error as failed", () => {
    expect(isMissingFile(new Error("HTTP 503: host offline"))).toBe(false);
    expect(isMissingFile(new Error("timeout"))).toBe(false);
    expect(isMissingFile({ status: 500 })).toBe(false);
    expect(isMissingFile(null)).toBe(false);
  });
});
