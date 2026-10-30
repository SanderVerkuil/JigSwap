import {
  canStillSettle,
  type CopyId,
  type CopyReservationPort,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { convexCopyPort } from "../../exchange/adapters/convexCopyPort";
import { toDomain } from "../../exchange/adapters/mapper";

// Active-exchange statuses that reserve a copy: a proposed or accepted exchange is "in flight"
// and the copy may not be re-offered until it resolves (rejected/cancelled/completed/disputed
// release it). Mirrors the Exchange context's notion of an in-progress deal.
const ACTIVE_STATUSES = new Set(["proposed", "accepted"]);

// Driven adapter for the CopyReservationPort: the cross-context seam to Exchange. The Library
// asks "is this copy reserved?" instead of knowing about the `exchanges` table shape. The
// domain CopyId is the copy's aggregateId; exchanges reference copies by Convex _id, so resolve
// first, then check whether an active exchange that offers/requests it could still settle.
// A deal that no longer could (the copy changed hands, the housemate who offered it left the
// household, the swap's other copy did either) reserves nothing, so a stale deal never locks the
// current owner out of re-offering or deleting their copy. "Could still settle" is the Exchange
// context's own rule (canStillSettle: the settlement guard accept and confirm run), read through
// Exchange's CopyPort. Rows without an aggregateId can't be acted on at all and reserve nothing.
// An open loan reserves the copy too: while it is at the borrower's it can't be re-offered or
// deleted until it is back (returned or recalled). Only a loan the current owner made counts: one a
// former owner left open (a transfer before transfers ended loans) never locks the new owner out.
export const convexCopyReservationPort = (
  ctx: QueryCtx,
): CopyReservationPort => ({
  async isReserved(copyId: CopyId): Promise<boolean> {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", copyId as string),
      )
      .unique();
    if (!copy) return false;

    // Loans name the copy by its aggregateId; a copy's loans are few.
    const openLoan = await ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", copyId as string))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "open"),
          q.eq(q.field("lenderId"), copy.ownerId),
        ),
      )
      .first();
    if (openLoan) return true;

    const ownedPuzzleId = copy._id as Id<"ownedPuzzles">;

    // Indexed lookup of exchanges that reference the copy as requested or offered (union of the
    // two indexes), then keep only those in an active status — no full-table scan.
    const [asRequested, asOffered] = await Promise.all([
      ctx.db
        .query("exchanges")
        .withIndex("by_requested_copy", (q) =>
          q.eq("requestedPuzzleId", ownedPuzzleId),
        )
        .collect(),
      ctx.db
        .query("exchanges")
        .withIndex("by_offered_copy", (q) =>
          q.eq("offeredPuzzleId", ownedPuzzleId),
        )
        .collect(),
    ]);
    const stillSettles = canStillSettle(convexCopyPort(ctx));
    for (const row of [...asRequested, ...asOffered]) {
      if (!ACTIVE_STATUSES.has(row.status) || row.aggregateId === undefined) {
        continue;
      }
      if (await stillSettles(toDomain(row))) return true;
    }
    return false;
  },
});
