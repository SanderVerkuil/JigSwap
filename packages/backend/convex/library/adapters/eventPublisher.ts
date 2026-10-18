import type { DomainEventPublisher, LibraryDomainEvent } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";
import { deleteCircleSharesOfCopy } from "../../sharing/adapters/circleCopyShares";
import { deleteCollectionMembershipsOfCopy } from "./convexCollectionRepository";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It durably
// records + schedules Library's events (CopyAcquired, CollectionCreated, ...) for the async
// subscribers, and keeps ONE critical reaction inline, in the SAME transaction:
// CopyOwnershipTransferred withdraws the copy's circle shares — the previous owner shared it into
// their circles, and without this the old owner's circle members keep reaching the new owner's
// (open) copy through a circle the new owner never joined. Sharing owns that read model; this
// only invokes its withdrawal. The same reaction takes the copy out of the previous owner's
// collections, which would otherwise keep listing the new owner's copy.
export const libraryEventPublisher = (ctx: MutationCtx): DomainEventPublisher =>
  makeEventPublisher(ctx, "library", async (events) => {
    for (const event of events as readonly LibraryDomainEvent[]) {
      if (event.name === "CopyOwnershipTransferred") {
        await deleteCircleSharesOfCopy(ctx, event.copyId as string);
        await deleteCollectionMembershipsOfCopy(ctx, event.copyId as string);
      }
    }
  });
