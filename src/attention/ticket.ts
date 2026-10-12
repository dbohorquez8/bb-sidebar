import type { TicketMatch } from "./types";

const BOUNDARY_CHAR = /[\p{L}\p{N}]/u;

// A prefix entered without its trailing hyphen ("WS") also matches the
// hyphenated form ("WS-19"), so the chip does not depend on that keystroke.
function prefixForms(prefix: string): string[] {
  return prefix.endsWith("-") ? [prefix] : [`${prefix}-`, prefix];
}

function idAt(text: string, start: number, sortedPrefixes: readonly string[]): string | null {
  for (const prefix of sortedPrefixes.flatMap(prefixForms)) {
    if (!text.startsWith(prefix, start)) continue;
    let digitsEnd = start + prefix.length;
    while (digitsEnd < text.length && text[digitsEnd] >= "0" && text[digitsEnd] <= "9") {
      digitsEnd++;
    }
    if (digitsEnd === start + prefix.length) continue;
    const next = text[digitsEnd];
    if (next !== undefined && BOUNDARY_CHAR.test(next)) continue;
    return text.slice(start, digitsEnd);
  }
  return null;
}

function idAtStartOrAfterSlash(name: string, sortedPrefixes: readonly string[]): string | null {
  const atStart = idAt(name, 0, sortedPrefixes);
  if (atStart) return atStart;
  for (let index = 0; index < name.length; index++) {
    if (name[index] !== "/") continue;
    const id = idAt(name, index + 1, sortedPrefixes);
    if (id) return id;
  }
  return null;
}

export function parseTicketId(
  input: { title: string; branchName: string | null; worktreeName: string | null },
  prefixes: readonly string[],
): TicketMatch | null {
  if (prefixes.length === 0) return null;
  const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length);

  const trimmedTitle = input.title.trim();
  const titleId = idAt(trimmedTitle, 0, sortedPrefixes);
  if (titleId) {
    const rest = trimmedTitle.slice(titleId.length);
    return { id: titleId, source: "title", titleRest: stripTicketSeparator(rest) };
  }

  if (input.branchName !== null) {
    const branchId = idAtStartOrAfterSlash(input.branchName, sortedPrefixes);
    if (branchId) return { id: branchId, source: "branch", titleRest: null };
  }

  if (input.worktreeName !== null) {
    const worktreeId = idAtStartOrAfterSlash(input.worktreeName, sortedPrefixes);
    if (worktreeId) return { id: worktreeId, source: "branch", titleRest: null };
  }

  return null;
}

export function stripTicketSeparator(rest: string): string {
  return rest.replace(/^\s*[:\-–—]?\s*/, "");
}
