/**
 * Nesting through hidden threads.
 *
 * bb never lists hidden threads in the sidebar's live view, so a visible child
 * whose parent is hidden (an orchestrator's hidden coordinator, say) looks
 * like an orphan and lands in the flat list. Given the parent of each hidden
 * thread, these helpers point such a child at its nearest listed ancestor.
 */

type ThreadLink = { id: string; parentThreadId: string | null };

/** Parent ids that no listed thread has, sorted and unique. */
export function missingParentIds(threads: readonly ThreadLink[]): string[] {
  const listed = new Set(threads.map((thread) => thread.id));
  const missing = new Set<string>();
  for (const thread of threads) {
    if (thread.parentThreadId !== null && !listed.has(thread.parentThreadId)) {
      missing.add(thread.parentThreadId);
    }
  }
  return [...missing].sort();
}

/**
 * Each thread whose parent is a hidden thread gets that chain's first listed
 * ancestor as its parent. A chain that never reaches a listed thread keeps
 * the original parent, so a true orphan still shows in the flat list.
 */
export function nestThroughHiddenParents<T extends ThreadLink>(
  threads: readonly T[],
  hiddenParents: Readonly<Record<string, string | null>>,
): readonly T[] {
  const listed = new Set(threads.map((thread) => thread.id));
  let changed = false;
  const result = threads.map((thread) => {
    const parent = thread.parentThreadId;
    if (parent === null || listed.has(parent)) return thread;
    const seen = new Set<string>();
    let current: string | null = parent;
    while (current !== null && !listed.has(current) && !seen.has(current)) {
      seen.add(current);
      current = Object.hasOwn(hiddenParents, current) ? hiddenParents[current]! : null;
    }
    if (current === null || !listed.has(current) || current === thread.id) return thread;
    changed = true;
    return { ...thread, parentThreadId: current };
  });
  return changed ? result : threads;
}
