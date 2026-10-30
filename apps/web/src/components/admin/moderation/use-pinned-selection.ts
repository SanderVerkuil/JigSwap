import { useState } from "react";

export type PinnedSelection<T> = {
  /** The selected row's id: the requested (URL) one, else the row pinned on first load. */
  selectedId: string | null;
  /** The selected row: live, or its last-seen snapshot once it has left the queue. */
  item: T | undefined;
  /** The selected row left the queue without this reviewer deciding it (handled elsewhere). */
  gone: boolean;
  /**
   * Where to go next: the row after the selection (before it at the end of the queue), or, once
   * the selection is gone, the row that took its place. Null when there is nowhere to go.
   */
  nextId: string | null;
  /**
   * Called right before this reviewer decides `id`, so the row leaving the queue moves the
   * selection to its neighbour instead of reporting it gone. Null withdraws it (a failed decision).
   */
  expectRemoval: (id: string | null) => void;
};

type Snapshot<T> = { id: string; item: T; index: number };

/**
 * The selection of a live moderation queue that never moves under the reviewer. A queue sorted
 * newest first used to fall back to `items[0]`, so a new arrival silently replaced the default
 * selection (and an open Edit & Approve dialog re-seeded from, and saved, the other item). Here:
 * - with no requested row, the first row is pinned once, on first load, and stays selected
 *   (an emptied queue selects nothing, and pins its next arrival);
 * - a requested row (the URL's `item`) replaces the pin and stays pinned when the request clears;
 * - when the pinned row disappears, the last-seen snapshot stays on screen with `gone`, so the
 *   reviewer sees it was handled elsewhere and moves on with `nextId`;
 * - unless the reviewer decided it here (`expectRemoval`): then its neighbour takes over.
 * All state is adjusted during render (React's "storing information from previous renders"
 * pattern), never in an effect.
 */
export function usePinnedSelection<T>(
  items: readonly T[] | undefined,
  getId: (item: T) => string,
  requestedId: string | undefined,
): PinnedSelection<T> {
  const [pinned, setPinned] = useState<string | null>(requestedId ?? null);
  const [prevRequested, setPrevRequested] = useState(requestedId);
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [expected, setExpected] = useState<string | null>(null);

  let current = pinned;
  if (requestedId !== prevRequested) {
    setPrevRequested(requestedId);
    if (requestedId !== undefined && requestedId !== current) {
      current = requestedId;
      setPinned(current);
    }
  }

  if (items === undefined) {
    return {
      selectedId: current,
      item: undefined,
      gone: false,
      nextId: null,
      expectRemoval: setExpected,
    };
  }

  // An empty queue selects nothing (the caller shows "all clear"); the next arrival is pinned.
  if (items.length === 0 && current !== null) {
    current = null;
    setPinned(null);
  }
  if (current === null && items.length > 0) {
    current = getId(items[0]);
    setPinned(current);
  }

  const indexOf = (id: string | null) =>
    id === null ? -1 : items.findIndex((item) => getId(item) === id);
  let index = indexOf(current);
  const known = snapshot !== null && snapshot.id === current;

  // Decided here: the row that took its place (or the new last row) takes over.
  if (index === -1 && current !== null && current === expected) {
    const at = known ? Math.min(snapshot.index, items.length - 1) : 0;
    current = at >= 0 && items[at] ? getId(items[at]) : null;
    setPinned(current);
    setExpected(null);
    index = indexOf(current);
  }

  const live = index === -1 ? undefined : items[index];
  if (
    live !== undefined &&
    current !== null &&
    (snapshot === null ||
      snapshot.id !== current ||
      snapshot.item !== live ||
      snapshot.index !== index)
  ) {
    setSnapshot({ id: current, item: live, index });
  }

  const idAt = (at: number) => {
    const item = items[at];
    return item === undefined ? null : getId(item);
  };
  if (live !== undefined) {
    return {
      selectedId: current,
      item: live,
      gone: false,
      nextId: idAt(index + 1) ?? idAt(index - 1),
      expectRemoval: setExpected,
    };
  }
  const stillKnown = snapshot !== null && snapshot.id === current;
  return {
    selectedId: current,
    item: stillKnown ? snapshot.item : undefined,
    gone: current !== null,
    nextId: stillKnown
      ? idAt(Math.min(snapshot.index, items.length - 1))
      : idAt(0),
    expectRemoval: setExpected,
  };
}
