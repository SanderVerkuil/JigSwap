import type { DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Catalog has no
// CRITICAL in-transaction reaction (no sync handlers); it durably records + schedules its events
// for the async subscribers. Notifications maps PuzzleDefinitionApproved/Rejected -> the
// submitter's "puzzle_approved"/"puzzle_rejected".
export const catalogEventPublisher = (ctx: MutationCtx): DomainEventPublisher =>
  makeEventPublisher(ctx, "catalog");
