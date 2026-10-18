import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { handleDomainEvent as handleConversationEvent } from "../conversation/subscriber";
import { handleDomainEvent as handleCustodyEvent } from "../custody/subscriber";
import { handleDomainEvent as handleTradeRevealEvent } from "../exchange/tradeRevealSubscriber";
import { logEvent } from "../lib/logEvent";
import { handleDomainEvent as handleOpenLoanEvent } from "../library/openLoanOnSettlement";
import { handleDomainEvent as handleLibraryTransferEvent } from "../library/transferOnSettlement";
import { handleDomainEvent as handleNotificationEvent } from "../notifications/subscriber";

// The central async dispatcher. Scheduled once per recorded domain event; it loads the row, routes
// it to every registered ASYNC subscriber (Notifications, Conversation, Custody, the Library
// transfer + open-loan reactions), then stamps processedAt.
//
// Failure semantics: Convex retries a scheduled mutation only on ITS OWN internal errors, never on
// an application error thrown by our code. So each subscriber runs in its own sub-transaction
// (ctx.runMutation): a throw rolls back only that subscriber's writes, the others still commit,
// and the failure is caught here, logged as a structured `events.dispatch` error wide event (also
// forwarded to Axiom), and recorded on the event row. What happens next is per handler:
//   - retry: true  — idempotent (guarded by a natural-key check), so it is re-dispatched with
//                    exponential backoff, up to MAX_ATTEMPTS passes; completed handlers are skipped.
//   - retry: false — re-running could duplicate a member-visible effect, so it gives up at once.
// A handler that gave up lands in failedHandlers; once nothing is left to retry the event gets
// failedAt (queryable via by_failed) and needs an operator. `after` keeps an ordering dependency:
// the handler waits for (or, if it gave up, gives up with) the handler it depends on.
const HANDLERS = [
  // The per-trade owner reveal lands BEFORE notifications so a notification sees the fresh row.
  // Idempotent: recordTradeReveal is a no-op once the exchange has a reveal.
  { name: "tradeReveal", run: handleTradeRevealEvent, retry: true },
  // Inserts notification rows + schedules email/push with no dedupe key.
  { name: "notifications", run: handleNotificationEvent, retry: false },
  // Opens the exchange thread (idempotent) but APPENDS a lifecycle system message.
  { name: "conversation", run: handleConversationEvent, retry: false },
  // Records the pre-transfer owner with a plain insert, so it MUST run before the library transfer.
  { name: "custody", run: handleCustodyEvent, retry: false },
  // Reassigns the owner and resets owner-scoped fields; a re-run re-emits CopyOwnershipTransferred.
  {
    name: "libraryTransfer",
    run: handleLibraryTransferEvent,
    retry: false,
    after: "custody",
  },
  // A settled lend opens a loan (reacts to PossessionTransferred); a re-run opens a second loan.
  { name: "openLoan", run: handleOpenLoanEvent, retry: false },
] as const satisfies readonly {
  name: string;
  run: (ctx: MutationCtx, event: Doc<"domainEvents">) => Promise<void>;
  retry: boolean;
  after?: string;
}[];

export const MAX_ATTEMPTS = 5;
// Backoff before pass n+1 is RETRY_BASE_MS * 2^(n-1): 1, 2, 4, 8 minutes.
const RETRY_BASE_MS = 60_000;
// Error messages are domain codes / developer strings; cap them so a log line stays bounded.
const MAX_ERROR_LENGTH = 500;

const errorMessage = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, MAX_ERROR_LENGTH);

// One subscriber, in its own sub-transaction (called via ctx.runMutation from dispatch only).
export const runSubscriber = internalMutation({
  args: {
    eventId: v.id("domainEvents"),
    handler: v.string(),
  },
  handler: async (ctx, { eventId, handler }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return;
    const h = HANDLERS.find((x) => x.name === handler);
    if (!h) throw new Error(`unknown event handler: ${handler}`);
    await h.run(ctx, event);
  },
});

export const dispatch = internalMutation({
  args: { eventId: v.id("domainEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return; // event row gone (e.g. test teardown); nothing to do.
    // Already handled, or terminally failed: a no-op against duplicate scheduling.
    if (event.processedAt !== undefined || event.failedAt !== undefined) return;

    const attempt = (event.attempts ?? 0) + 1;
    const completed = new Set<string>(event.completedHandlers ?? []);
    const gaveUp = new Set<string>(event.failedHandlers ?? []);
    const failures: { handler: (typeof HANDLERS)[number]; message: string }[] =
      [];

    for (const h of HANDLERS) {
      if (completed.has(h.name) || gaveUp.has(h.name)) continue;
      if ("after" in h && !completed.has(h.after)) {
        if (gaveUp.has(h.after)) gaveUp.add(h.name);
        continue; // wait for the dependency's retry.
      }
      try {
        await ctx.runMutation(internal.events.dispatch.runSubscriber, {
          eventId,
          handler: h.name,
        });
        completed.add(h.name);
      } catch (e) {
        failures.push({ handler: h, message: errorMessage(e) });
        if (!h.retry) gaveUp.add(h.name);
      }
    }

    // Clean first pass: keep the row shape it always had.
    if (failures.length === 0 && attempt === 1 && gaveUp.size === 0) {
      await ctx.db.patch(eventId, { processedAt: Date.now() });
      return;
    }

    const pending = HANDLERS.filter(
      (h) => !completed.has(h.name) && !gaveUp.has(h.name),
    );
    const willRetry = pending.length > 0 && attempt < MAX_ATTEMPTS;
    if (!willRetry) for (const h of pending) gaveUp.add(h.name);

    for (const { handler, message } of failures) {
      const line = logEvent({
        event: "events.dispatch",
        outcome: "error",
        event_id: eventId,
        event_name: event.name,
        event_context: event.context,
        handler: handler.name,
        attempt,
        max_attempts: MAX_ATTEMPTS,
        retryable: handler.retry,
        will_retry: willRetry && handler.retry,
        error_message: message,
      });
      // Mutations cannot reach Axiom (Node-only SDK); hand the line to a Node action.
      await ctx.scheduler.runAfter(
        0,
        internal.events.ingestDispatchFailure.ingest,
        { line },
      );
    }

    const last = failures[failures.length - 1];
    await ctx.db.patch(eventId, {
      attempts: attempt,
      completedHandlers: [...completed],
      failedHandlers: [...gaveUp],
      ...(last && {
        lastError: { handler: last.handler.name, message: last.message },
      }),
      ...(pending.length === 0 && gaveUp.size === 0
        ? { processedAt: Date.now() }
        : willRetry
          ? {}
          : { failedAt: Date.now() }),
    });
    if (willRetry) {
      await ctx.scheduler.runAfter(
        RETRY_BASE_MS * 2 ** (attempt - 1),
        internal.events.dispatch.dispatch,
        { eventId },
      );
    }
  },
});
