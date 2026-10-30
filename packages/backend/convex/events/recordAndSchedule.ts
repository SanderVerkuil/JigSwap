import type { DomainEvent } from "@jigswap/domain";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

/**
 * Event fields the durable log never keeps (SEC-71): free text a member typed (comment text, copy
 * notes, collection and category names, profile display name) and the identity they registered
 * with (email, Clerk id). No subscriber, read model or the activity feed reads them from the log:
 * each reads the source row, which the member can edit or delete and the account purge removes.
 * Kept in the log they would outlive both, so recordAndSchedule leaves them out and
 * events/redactPayloads strips them from rows recorded before. A field a subscriber reads must
 * not be listed here: ChangeProposalRejected.reason and CircleDeleted.circleName feed
 * Notifications and stay.
 */
export const REDACTED_EVENT_FIELDS: ReadonlySet<string> = new Set([
  "text",
  "notes",
  "displayName",
  "email",
  "clerkId",
  "collectionName",
  "categoryName",
]);

/** The payload without REDACTED_EVENT_FIELDS (top-level event fields). */
export const redactPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => !REDACTED_EVENT_FIELDS.has(key)),
  );

// Serialize a domain event's own data fields for the durable log. Domain ids are branded strings
// (store as-is); Date fields are converted to epoch millis so the payload is plain JSON. `name`
// and `occurredAt` are lifted to dedicated columns, so they are excluded from `payload`, and so
// are REDACTED_EVENT_FIELDS.
const serializePayload = (event: DomainEvent): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "name" || key === "occurredAt") continue;
    if (REDACTED_EVENT_FIELDS.has(key)) continue;
    payload[key] = value instanceof Date ? value.getTime() : value;
  }
  return payload;
};

// Append each domain event to the durable `domainEvents` log and schedule the async dispatcher to
// fan it out to subscribers. WHY split record + schedule: the row is written in the SAME
// transaction as the emitting mutation (so an event is never lost if the mutation commits), while
// the heavier subscriber work runs out-of-band via the scheduler — keeping the mutation fast and
// the contexts decoupled.
export const recordAndSchedule = async (
  ctx: MutationCtx,
  context: string,
  events: readonly DomainEvent[],
): Promise<void> => {
  for (const event of events) {
    const eventId = await ctx.db.insert("domainEvents", {
      name: event.name,
      payload: serializePayload(event),
      occurredAt: event.occurredAt.getTime(),
      context,
    });
    await ctx.scheduler.runAfter(0, internal.events.dispatch.dispatch, {
      eventId,
    });
  }
};
