// Scroll anchoring for the thread view's infinite scroll-up: when an older
// page is prepended, the content the reader was looking at must not move.

// The scroller as last recorded, before the next commit lands.
export type ScrollSnapshot = {
  // Oldest rendered message id (ascending list's first item).
  oldestId: string | undefined;
  scrollTop: number;
  scrollHeight: number;
};

// The scrollTop that keeps the visible content still after older messages
// were prepended, or undefined when the change was not a prepend (first load,
// thread switch, appends at the bottom). It is a prepend only when the
// previous oldest message is still rendered but no longer first; all growth
// in scrollHeight then happened above the viewport.
export function anchoredScrollTop(
  previous: ScrollSnapshot | undefined,
  ascending: readonly { id: string }[],
  scrollHeight: number,
): number | undefined {
  if (previous?.oldestId === undefined) return undefined;
  const oldestId = previous.oldestId;
  if (ascending[0]?.id === oldestId) return undefined;
  if (!ascending.some((message) => message.id === oldestId)) return undefined;
  return previous.scrollTop + (scrollHeight - previous.scrollHeight);
}
