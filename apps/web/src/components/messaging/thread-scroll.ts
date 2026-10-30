// Scroll helpers for the thread view: anchoring for its infinite scroll-up
// (when an older page is prepended, the content the reader was looking at must
// not move), and where "at the bottom" begins.

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

// How far from the bottom still counts as having the newest messages in view.
const NEAR_BOTTOM_PX = 120;

// Whether the newest messages are in view: the scroller is at (or within
// NEAR_BOTTOM_PX of) its bottom, or doesn't scroll at all.
export function isNearBottom(scroller: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return (
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
    NEAR_BOTTOM_PX
  );
}
