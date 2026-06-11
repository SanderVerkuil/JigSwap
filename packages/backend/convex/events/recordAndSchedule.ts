import type { DomainEvent } from "@jigswap/domain";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

// Serialize a domain event's own data fields for the durable log. Domain ids are branded strings
// (store as-is); Date fields are converted to epoch millis so the payload is plain JSON. `name`
// and `occurredAt` are lifted to dedicated columns, so they are excluded from `payload`.
const serializePayload = (event: DomainEvent): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "name" || key === "occurredAt") continue;
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
