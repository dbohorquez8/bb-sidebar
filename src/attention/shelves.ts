export function placeNeedsYouShelf<
  T extends { id: string; createdAt: number; isPinned: boolean; isArchived: boolean },
>(
  threads: readonly T[], // every thread, all projects, children included
  isNeedsYou: (thread: T) => boolean,
  needsYouSince: (thread: T) => number,
): { needsYou: T[]; movedIds: ReadonlySet<string> } {
  const matched = threads.filter(
    (thread) => !thread.isArchived && !thread.isPinned && isNeedsYou(thread),
  );
  const needsYou = [...matched].sort((a, b) => {
    const sinceDiff = needsYouSince(a) - needsYouSince(b);
    if (sinceDiff !== 0) return sinceDiff;
    const createdDiff = b.createdAt - a.createdAt;
    if (createdDiff !== 0) return createdDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { needsYou, movedIds: new Set(needsYou.map((thread) => thread.id)) };
}
