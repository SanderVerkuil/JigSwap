import type {
  CopyInstanceTimelineEntry,
  CopyInstanceView,
  ProjectedMember,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { projectMemberIdentity } from "../social/privacy";

// Privacy-gated detail read for a single owned COPY (instance). Auth-gated; the acting member is the
// viewer. Assembles the copy's catalog/condition snapshot, its (projected) current owner, and one
// merged chronological event stream drawn from three sources that key the copy DIFFERENTLY:
//   - copyCustodyEntries.copyId   = the copy's ownedPuzzles _id      (ownership transfers)
//   - completions.ownedPuzzleId   = the copy's ownedPuzzles _id      (completions)
//   - loans.copyId                = the copy's ownedPuzzles aggregateId (loans)
// So the copy row is resolved FIRST, then each source is queried with its own key form. Every member
// surfaced is run through `projectMemberIdentity` (salt = copyId), which anonymises hidden members
// server-side — their real identity never enters the returned DTO. The stream is split into `since`
// (the viewer's own tenure) and `before` (gated history); non-owners get everything in `before`.
export const getCopyInstanceView = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CopyInstanceView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) return null;

    const puzzle = await ctx.db.get(copy.puzzleId);
    const salt = args.copyId as string;

    // Memoise the projection per target member so a hidden member yields one stable anonRef across
    // every entry in this timeline (same target + same salt -> same token).
    const projections = new Map<string, Promise<ProjectedMember>>();
    const project = (targetId: string): Promise<ProjectedMember> => {
      const existing = projections.get(targetId);
      if (existing) return existing;
      const p = projectMemberIdentity(
        ctx,
        viewerId,
        targetId as Id<"users">,
        salt,
      );
      projections.set(targetId, p);
      return p;
    };

    // --- Source 1: ownership transfers (custody projection, keyed by _id). ---
    const custodyEntries = await ctx.db
      .query("copyCustodyEntries")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .order("asc")
      .collect();

    // --- Source 2: completions (keyed by ownedPuzzleId = _id). ---
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", args.copyId))
      .collect();

    // --- Source 3: loans (keyed by aggregateId). ---
    const loans = copy.aggregateId
      ? await ctx.db
          .query("loans")
          .withIndex("by_copy", (q) =>
            q.eq("copyId", copy.aggregateId as string),
          )
          .order("asc")
          .collect()
      : [];

    // Build each event, projecting every participant. Done with Promise.all so the memoised
    // projections are shared across entries.
    const transferEntries: CopyInstanceTimelineEntry[] = await Promise.all(
      custodyEntries.map(async (e) => ({
        type: "transfer" as const,
        from: await project(e.previousOwner),
        to: await project(e.newOwner),
        viaExchange: e.exchangeId !== "" && e.exchangeId != null,
        occurredAt: e.occurredAt,
      })),
    );

    const completionEntries: CopyInstanceTimelineEntry[] = await Promise.all(
      completions.map(async (c) => ({
        type: "completion" as const,
        solver: await project(c.userId),
        startDate: c.startDate,
        endDate: c.endDate,
        timeMinutes: c.completionTimeMinutes,
        occurredAt: c.endDate ?? c.startDate,
      })),
    );

    const loanEntries: CopyInstanceTimelineEntry[] = await Promise.all(
      loans.map(async (l) => ({
        type: "loan" as const,
        lender: await project(l.lenderId),
        borrower: await project(l.borrowerId),
        openedAt: l.openedAt,
        closedAt: l.closedAt,
        status: l.status,
        occurredAt: l.openedAt,
      })),
    );

    const timeline = [
      ...transferEntries,
      ...completionEntries,
      ...loanEntries,
    ].sort((a, b) => a.occurredAt - b.occurredAt);

    const viewerIsOwner = copy.ownerId === viewerId;

    // The acquisition boundary: the latest custody transfer that handed the copy TO the viewer,
    // else the copy's creation time. Only meaningful when the viewer owns the copy.
    const viewerTransfers = custodyEntries.filter(
      (e) => e.newOwner === (viewerId as string),
    );
    const acquiredByViewerAt =
      viewerTransfers.length > 0
        ? Math.max(...viewerTransfers.map((e) => e.occurredAt))
        : copy.createdAt;

    const since: CopyInstanceTimelineEntry[] = [];
    const before: CopyInstanceTimelineEntry[] = [];
    if (viewerIsOwner) {
      for (const entry of timeline) {
        if (entry.occurredAt >= acquiredByViewerAt) since.push(entry);
        else before.push(entry);
      }
    } else {
      before.push(...timeline);
    }

    const owner = await project(copy.ownerId);

    return {
      copyId: copy._id,
      viewerIsOwner,
      owner,
      snapshot: {
        title: copy.snapshot?.title ?? puzzle?.title ?? "Unknown Puzzle",
        brand: copy.snapshot?.brand ?? puzzle?.brand,
        pieceCount: copy.snapshot?.pieceCount ?? puzzle?.pieceCount ?? 0,
        image: copy.snapshot?.thumbnail,
        condition: copy.condition,
        notes: copy.notes,
        availability: copy.availability,
        acquisitionDate: copy.acquisitionDate,
        acquisitionSource: copy.acquisitionSource,
      },
      acquiredByViewerAt,
      since,
      before,
    };
  },
});
