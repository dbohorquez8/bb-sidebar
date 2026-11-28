import { describe, expect, it } from "vitest";

import { CHECK_THRESHOLD_DEFAULT_MINUTES, STATUS_DIR } from "./status-constants";
import { decodeFileBody, parseStatusFile, statusFilePath } from "./status-file";

function file(over: Partial<Record<string, string>> = {}, tail = ""): string {
  const f = {
    kind: "implementer",
    role: "",
    phase: "Building",
    state: "Stopped",
    "state-check": "verified",
    counts: "",
    updated: "2026-11-27T10:00:05Z",
    ...over,
  };
  const line = (k: string) => (f[k as keyof typeof f] === "" ? `${k}:` : `${k}: ${f[k as keyof typeof f]}`);
  return [
    "---",
    line("kind"),
    line("role"),
    line("phase"),
    line("state"),
    line("state-check"),
    line("counts"),
    line("updated"),
    "---",
    tail,
  ].join("\n");
}

describe("constants", () => {
  it("locks the status dir and the check threshold default", () => {
    expect(STATUS_DIR).toBe(".claude/status");
    expect(CHECK_THRESHOLD_DEFAULT_MINUTES).toBe(40);
  });
});

describe("statusFilePath", () => {
  it("joins the environment path, status dir and thread id", () => {
    expect(statusFilePath("/home/u/proj", "thr_1")).toBe("/home/u/proj/.claude/status/thr_1.md");
  });
  it("does not double the slash for a trailing slash", () => {
    expect(statusFilePath("/home/u/proj/", "thr_1")).toBe("/home/u/proj/.claude/status/thr_1.md");
  });
});

describe("parseStatusFile valid", () => {
  it("parses every field", () => {
    const parsed = parseStatusFile(file({ counts: "2 / 5", role: "Builder" }));
    expect(parsed).toEqual({
      kind: "implementer",
      phase: "Building",
      state: "Stopped",
      stateCheck: "verified",
      counts: { done: 2, total: 5 },
      updatedMs: Date.parse("2026-11-27T10:00:05Z"),
    });
  });
  it("gives null for empty phase and state", () => {
    const parsed = parseStatusFile(file({ phase: "", state: "" }));
    expect(parsed?.phase).toBeNull();
    expect(parsed?.state).toBeNull();
  });
  it("VF-1 ignores free text after the closing ---", () => {
    const parsed = parseStatusFile(file({}, "free text\nmore: lines\r\n�"));
    expect(parsed?.state).toBe("Stopped");
    expect(parsed?.kind).toBe("implementer");
  });
  it("accepts each kind and each state-check", () => {
    for (const kind of ["orchestrator", "implementer", "worker", "session"]) {
      expect(parseStatusFile(file({ kind }))?.kind).toBe(kind);
    }
    for (const check of ["verified", "unverified", "unchecked"]) {
      expect(parseStatusFile(file({ "state-check": check }))?.stateCheck).toBe(check);
    }
  });
});

describe("parseStatusFile malformed", () => {
  const valid = file();
  const lines = valid.split("\n");

  it("MF-1 a missing counts line (eight lines)", () => {
    const l = [...lines];
    l.splice(6, 1);
    expect(parseStatusFile(l.slice(0, 8).join("\n"))).toBeNull();
  });
  it("MF-2 phase and state lines swapped", () => {
    const l = [...lines];
    [l[3], l[4]] = [l[4], l[3]];
    expect(parseStatusFile(l.join("\n"))).toBeNull();
  });
  it("MF-3 kind: reviewer", () => {
    expect(parseStatusFile(file({ kind: "reviewer" }))).toBeNull();
  });
  it("MF-4 no closing ---", () => {
    const l = [...lines];
    l[8] = "end";
    expect(parseStatusFile(l.join("\n"))).toBeNull();
  });
  it("MF-5 empty file", () => {
    expect(parseStatusFile("")).toBeNull();
  });
  it("MF-6 an extra key line before the closing ---", () => {
    const l = [...lines];
    l.splice(8, 0, "extra: x");
    expect(parseStatusFile(l.join("\n"))).toBeNull();
  });
  it("MF-7 a U+FFFD from a non-UTF-8 byte in role", () => {
    expect(parseStatusFile(file({ role: "Bui�lder" }))).toBeNull();
  });
  it("MF-8 updated: yesterday", () => {
    expect(parseStatusFile(file({ updated: "yesterday" }))).toBeNull();
  });
  it("rejects a CR in any of the nine lines", () => {
    expect(parseStatusFile(file().replace("kind: implementer", "kind: implementer\r"))).toBeNull();
  });
  it("rejects an unknown state-check", () => {
    expect(parseStatusFile(file({ "state-check": "maybe" }))).toBeNull();
  });
  it("rejects an updated date that rolls over", () => {
    expect(parseStatusFile(file({ updated: "2026-02-31T10:00:00Z" }))).toBeNull();
  });
  it("rejects an updated value without the Z", () => {
    expect(parseStatusFile(file({ updated: "2026-11-27T10:00:05" }))).toBeNull();
  });
  it("rejects a key line with a trailing-space empty value", () => {
    expect(parseStatusFile(file().replace("phase: Building", "phase: "))).toBeNull();
  });
});

describe("counts edges", () => {
  const counts = (raw: string) => parseStatusFile(file({ counts: raw }))?.counts;
  it("reads 0 / 3 and 3 / 3", () => {
    expect(counts("0 / 3")).toEqual({ done: 0, total: 3 });
    expect(counts("3 / 3")).toEqual({ done: 3, total: 3 });
  });
  it("refuses D > T", () => {
    expect(counts("4 / 3")).toBeNull();
  });
  it("refuses T < 1", () => {
    expect(counts("0 / 0")).toBeNull();
  });
  it("refuses a non-integer", () => {
    expect(counts("1.5 / 3")).toBeNull();
    expect(counts("a / 3")).toBeNull();
    expect(counts("-1 / 3")).toBeNull();
  });
  it("refuses wrong spacing", () => {
    expect(counts("2/5")).toBeNull();
    expect(counts("2  / 5")).toBeNull();
    expect(counts("2 /5")).toBeNull();
  });
  it("keeps the rest of the file when counts are refused", () => {
    const parsed = parseStatusFile(file({ counts: "9 / 3" }));
    expect(parsed?.state).toBe("Stopped");
    expect(parsed?.counts).toBeNull();
  });
  it("is null when empty", () => {
    expect(counts("")).toBeNull();
  });
});

describe("decodeFileBody", () => {
  it("returns utf8 content as is", () => {
    expect(decodeFileBody({ content: "héllo", contentEncoding: "utf8" })).toBe("héllo");
    expect(decodeFileBody({ content: "plain" })).toBe("plain");
  });
  it("decodes base64 to the same text as the plain body", () => {
    const text = file({ counts: "1 / 2" });
    const b64 = Buffer.from(text, "utf8").toString("base64");
    const decoded = decodeFileBody({ content: b64, contentEncoding: "base64" });
    expect(decoded).toBe(text);
    expect(parseStatusFile(decoded as string)).toEqual(parseStatusFile(text));
  });
  it("returns null for base64 bytes that are not UTF-8", () => {
    const b64 = Buffer.from([0x66, 0xff, 0xfe, 0x6f]).toString("base64");
    expect(decodeFileBody({ content: b64, contentEncoding: "base64" })).toBeNull();
  });
  it("returns null for invalid base64", () => {
    expect(decodeFileBody({ content: "!!!not base64!!!", contentEncoding: "base64" })).toBeNull();
  });
  it("returns null for an unknown encoding", () => {
    expect(decodeFileBody({ content: "abc", contentEncoding: "latin1" })).toBeNull();
  });
  it("returns null for null content", () => {
    expect(decodeFileBody({ content: null as unknown as string })).toBeNull();
  });
  it("gives an empty body, which parses as no file", () => {
    const decoded = decodeFileBody({ content: "", contentEncoding: "utf8" });
    expect(decoded).toBe("");
    expect(parseStatusFile(decoded as string)).toBeNull();
  });
});
