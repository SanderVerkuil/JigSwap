import type { HouseholdCopyPermission } from "@jigswap/contracts";

// Pure rules for My Puzzles' selection mode: which copies can be selected, what a bulk offer action
// sends and leaves alone, how it is undone, and how a collection add is spread. Kept free of React
// and Convex so they are unit-tested on their own.

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
