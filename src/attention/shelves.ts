export function placeNeedsYouShelf<
  T extends { id: string; createdAt: number; isPinned: boolean; isArchived: boolean },
>(
  threads: readonly T[], // every thread, all projects, children included
  isNeedsYou: (thread: T) => boolean,
  needsYouSince: (thread: T) => number,
): { needsYou: T[]; movedIds: ReadonlySet<string> } {
  throw new Error("not implemented");
}
