import {
  type CopyId,
  makeTransferCopyOwnership,
  type OwnerId,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";

// Library's reaction to a settled swap/sale (Exchange's OwnershipTransferred): the SAME copy changes
// hands — the aggregate reassigns the owner and resets owner-scoped fields, keeping the physical
// record. A lend emits PossessionTransferred instead (handled by openLoanOnSettlement), so it never
// reaches here. Runs AFTER the custody subscriber in dispatch so custody records the pre-transfer owner.
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (event.name !== "OwnershipTransferred") return;
  const p = event.payload as Record<string, unknown>;

  const copy = await ctx.db.get(p.copyId as Id<"ownedPuzzles">);
  if (!copy?.aggregateId) return; // only domain-written copies carry a CopyId to transfer.

  const transfer = makeTransferCopyOwnership({
    copies: convexCopyRepository(ctx),
    events: noopEventPublisher(ctx),
    clock: systemClock,
  });
  // The new owner is the event's member id, which is the resolved users _id the copy row stores.
  await transfer({
    copyId: toId<"CopyId">(copy.aggregateId) as CopyId,
    newOwner: toId<"OwnerId">(p.newOwner as string) as OwnerId,
  });
};
