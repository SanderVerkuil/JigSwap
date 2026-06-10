import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The Chain-of-Custody subscriber: folds the durable `OwnershipTransferred` events into the
// `copyCustodyEntries` read-model, one row per transfer. WHY a subscriber (not inline in Exchange):
// keeps custody a decoupled projection — Exchange only publishes its domain events; this context
// owns the per-copy provenance read-model that the timeline query scans.
//
// Idempotency: the dispatcher only retries when its whole mutation rolled back (processedAt unset),
// so a failed insert never leaves a duplicate — the rolled-back row is gone on retry.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (event.name !== "OwnershipTransferred") return;
  const p = event.payload as Record<string, unknown>;
  await ctx.db.insert("copyCustodyEntries", {
    copyId: p.copyId as string,
    exchangeId: p.exchangeId as string,
    newOwner: p.newOwner as string,
    occurredAt: event.occurredAt,
  });
};
