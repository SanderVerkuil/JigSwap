import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The Chain-of-Custody subscriber: folds the durable `OwnershipTransferred` events into the
// `copyCustodyEntries` read-model, one row per OWNERSHIP transfer. WHY a subscriber (not inline in
// Exchange): keeps custody a decoupled projection — Exchange only publishes its domain events; this
// context owns the per-copy provenance read-model that the timeline query scans.
//
// Only ownership transfers reach here: a lend emits PossessionTransferred (not OwnershipTransferred),
// so loans never enter the ownership chain. previousOwner is the copy's owner read here, BEFORE the
// library transfer subscriber reassigns it (dispatch runs custody first).
//
// Not idempotent (a plain insert): a throw rolls back this subscriber's sub-transaction, and the
// dispatcher marks it failed instead of retrying it (events/dispatch), so no duplicate row lands.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (event.name !== "OwnershipTransferred") return;
  const p = event.payload as Record<string, unknown>;

  const copy = await ctx.db.get(p.copyId as Id<"ownedPuzzles">);
  if (!copy) return;

  await ctx.db.insert("copyCustodyEntries", {
    // Persist the resolved row's `_id`, not the raw payload value, so `copyId` always matches the
    // `ownedPuzzles._id` the timeline query indexes by (avoids _id vs aggregateId drift).
    copyId: copy._id as string,
    exchangeId: p.exchangeId as string,
    previousOwner: copy.ownerId,
    newOwner: p.newOwner as string,
    occurredAt: event.occurredAt,
  });
};
