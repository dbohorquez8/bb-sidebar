import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_SOFT_LIMIT, parseSoftLimit, resolveContextSoftLimit } from "./context-usage";

describe("parseSoftLimit", () => {
  it("reads plain numbers and k/m suffixes", () => {
    expect(parseSoftLimit("150000")).toBe(150_000);
    expect(parseSoftLimit("150k")).toBe(150_000);
    expect(parseSoftLimit(" 200 K ")).toBe(200_000);
    expect(parseSoftLimit("1.5m")).toBe(1_500_000);
    expect(parseSoftLimit("1_000,000")).toBe(1_000_000);
    expect(parseSoftLimit(120000)).toBe(120_000);
  });

  it("returns null for blank, malformed, zero, or non-text values", () => {
    for (const raw of ["", "  ", "abc", "-5", "0", "0k", "12x", undefined, null, true, {}, 0, -1, NaN]) {
      expect(parseSoftLimit(raw)).toBeNull();
    }
  });
});

describe("resolveContextSoftLimit", () => {
  it("follows context-ring's softLimit setting", () => {
    expect(resolveContextSoftLimit({ softLimit: "200k" })).toBe(200_000);
  });

  it("falls back to 150k when context-ring is absent or the value is invalid", () => {
    expect(DEFAULT_CONTEXT_SOFT_LIMIT).toBe(150_000);
    expect(resolveContextSoftLimit(undefined)).toBe(150_000);
    expect(resolveContextSoftLimit(null)).toBe(150_000);
    expect(resolveContextSoftLimit({})).toBe(150_000);
    expect(resolveContextSoftLimit({ softLimit: "" })).toBe(150_000);
    expect(resolveContextSoftLimit({ softLimit: "lots" })).toBe(150_000);
  });
});
