import {
  circleHiddenReason,
  SHARE_BATCH_SIZE,
} from "@/components/circles/circle-share";
import type { HouseholdCopyPermission } from "@jigswap/contracts";

// Pure rules for My Puzzles' selection mode: which copies can be selected, what a bulk offer action
// sends and leaves alone, how it is undone, and how a collection add or a circle share is spread.
// Kept free of React and Convex calls so they are unit-tested on their own.

// Mirrors the backend's MAX_OFFERS_BATCH: one `library.updateOffers` call takes at most 100 copies.
export const BULK_OFFERS_BATCH = 100;

// How many `collections.addOwnedPuzzle` calls run at once for a bulk "Add to collection".
export const COLLECTION_ADD_CONCURRENCY = 4;

export interface Offers {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export type BulkOfferAction = "offerSwap" | "offerLend" | "withdraw";

// What each action sends to `library.updateOffers`: offers only. No visibility (each copy keeps its
// owner's choice: a private copy is visible only while offered) and no price.
export const OFFER_CHANGES: Record<BulkOfferAction, Partial<Offers>> = {
  offerSwap: { forTrade: true },
  offerLend: { forLend: true },
  withdraw: { forTrade: false, forLend: false, forSale: false },
};

export interface BulkCopy {
  _id: string;
  aggregateId?: string;
  availability: Offers;
  visibility?: "private" | "visible";
}

// A copy can be selected when the viewer may manage it (their own, or a housemate's left at
// "manage") and it has the domain id the bulk calls take.
export const canSelectCopy = (
  copy: Pick<BulkCopy, "aggregateId">,
  household: { viewerAccess: HouseholdCopyPermission } | undefined,
): boolean => Boolean(copy.aggregateId) && household?.viewerAccess !== "view";

export const toggleSelection = (
  selected: ReadonlySet<string>,
  id: string,
): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// The selected copies a bulk action acts on: only those on screen now (a copy a filter or search
// hides stays selected but is left alone), in the list's order.
export const selectedInView = (
  selected: ReadonlySet<string>,
  visibleSelectableIds: readonly string[],
): string[] => visibleSelectableIds.filter((id) => selected.has(id));

const OFFER_FLAGS = ["forTrade", "forLend", "forSale"] as const;

const flagsOf = (change: Partial<Offers>) =>
  OFFER_FLAGS.filter((flag) => change[flag] !== undefined);

export interface OfferSend {
  copyId: string;
  previous: Offers;
  // Private before the change (so an offer makes it visible while it's on offer).
  wasPrivate: boolean;
}

export interface OfferPlan {
  // The copies the action changes, by domain id, with their offers before the change.
  send: OfferSend[];
  // Selected copies that already have the asked offers.
  unchanged: number;
}

export function planOfferAction(
  copies: readonly BulkCopy[],
  action: BulkOfferAction,
): OfferPlan {
  const change = OFFER_CHANGES[action];
  const plan: OfferPlan = { send: [], unchanged: 0 };
  for (const copy of copies) {
    if (!copy.aggregateId) continue;
    const changes = flagsOf(change).some(
      (flag) => copy.availability[flag] !== change[flag],
    );
    if (!changes) {
      plan.unchanged += 1;
      continue;
    }
    plan.send.push({
      copyId: copy.aggregateId,
      previous: {
        forTrade: copy.availability.forTrade,
        forLend: copy.availability.forLend,
        forSale: copy.availability.forSale,
      },
      wasPrivate: copy.visibility === "private",
    });
  }
  return plan;
}

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
};

// The calls that undo an offer action on the copies it changed: each flag the action set goes back
// to the copy's own earlier value, and only those flags (an offer the member changed in between on
// another flag is kept). Copies that had the same earlier values share one call.
export function undoChanges(
  action: BulkOfferAction,
  changed: readonly Pick<OfferSend, "copyId" | "previous">[],
): { copyIds: string[]; change: Partial<Offers> }[] {
  const flags = flagsOf(OFFER_CHANGES[action]);
  const groups = new Map<
    string,
    { copyIds: string[]; change: Partial<Offers> }
  >();
  for (const { copyId, previous } of changed) {
    const key = flags.map((flag) => previous[flag]).join();
    const group = groups.get(key);
    if (group) group.copyIds.push(copyId);
    else
      groups.set(key, {
        copyIds: [copyId],
        change: Object.fromEntries(flags.map((flag) => [flag, previous[flag]])),
      });
  }
  return [...groups.values()];
}

// The copies a bulk "Add to collection" sends: the member's own only. A housemate's copy never goes
// into the member's personal collections (the server refuses it too); it is counted instead.
export function planCollectionAdd(
  copies: readonly BulkCopy[],
  isHousemateCopy: (copyDocId: string) => boolean,
): { copyIds: string[]; housemates: number } {
  const copyIds: string[] = [];
  let housemates = 0;
  for (const copy of copies) {
    if (isHousemateCopy(copy._id)) housemates += 1;
    else if (copy.aggregateId) copyIds.push(copy.aggregateId);
  }
  return { copyIds, housemates };
}

export interface CircleSharePlan {
  // What's sent, by domain id: the member's own copies.
  copyIds: string[];
  // Selected housemates' copies, left out.
  housemates: number;
  // The sent copies circle members won't see even once shared: they only see what's on offer, and a
  // private copy is visible only while it is.
  hidden: string[];
}

// The copies a bulk "Share with circle" sends: only a copy's owner may share it (the server refuses
// the whole call otherwise), so a housemate's copy is counted instead, even one the member manages.
export function planCircleShare(
  copies: readonly BulkCopy[],
  isHousemateCopy: (copyDocId: string) => boolean,
): CircleSharePlan {
  const plan: CircleSharePlan = { copyIds: [], housemates: 0, hidden: [] };
  for (const copy of copies) {
    if (isHousemateCopy(copy._id)) {
      plan.housemates += 1;
    } else if (copy.aggregateId) {
      plan.copyIds.push(copy.aggregateId);
      if (circleHiddenReason(copy)) plan.hidden.push(copy.aggregateId);
    }
  }
  return plan;
}

export interface CircleShareOutcome {
  shared: number;
  alreadyShared: number;
  // Copies now in the circle, newly or already.
  done: string[];
  // Copies refused one by one: gone from the member's library since they were selected.
  gone: string[];
  // Copies in calls that failed for any other reason (offline, or the circle itself refused).
  failed: string[];
  // Why the last of those calls failed.
  refusal?: unknown;
}

// Share copies in server-sized calls, one after another (each call updates the same circle). A call
// is all or nothing: one copy that is no longer the member's refuses all of it. So `isGone` splits
// such a call in two and tries each half, down to the copies at fault, and the others still go in.
// Any other refusal fails the call's copies and the next call still runs.
export async function shareInBatches(
  copyIds: readonly string[],
  send: (
    copyIds: string[],
  ) => Promise<{ shared: number; alreadyShared: number }>,
  isGone: (error: unknown) => boolean,
): Promise<CircleShareOutcome> {
  const outcome: CircleShareOutcome = {
    shared: 0,
    alreadyShared: 0,
    done: [],
    gone: [],
    failed: [],
  };
  const sendAll = async (ids: string[]): Promise<void> => {
    try {
      const { shared, alreadyShared } = await send(ids);
      outcome.shared += shared;
      outcome.alreadyShared += alreadyShared;
      outcome.done.push(...ids);
    } catch (error) {
      if (!isGone(error)) {
        outcome.failed.push(...ids);
        outcome.refusal = error;
      } else if (ids.length === 1) {
        outcome.gone.push(...ids);
      } else {
        const middle = Math.ceil(ids.length / 2);
        await sendAll(ids.slice(0, middle));
        await sendAll(ids.slice(middle));
      }
    }
  };
  for (const batch of chunk(copyIds, SHARE_BATCH_SIZE)) await sendAll(batch);
  return outcome;
}

// Run `task` over every item with at most `limit` running at once. A failing item doesn't stop
// the rest; the result says which went through.
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<{ succeeded: T[]; failed: T[] }> {
  const succeeded: T[] = [];
  const failed: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
        succeeded.push(item);
      } catch {
        failed.push(item);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return { succeeded, failed };
}
