import type {
  CopyCompletionEntry,
  CopyInstanceTimelineEntry,
  CopyInstanceView,
  CopyLoanEntry,
  CopyPhoto,
  CopyReviewEntry,
  CopyTransferEntry,
  ProjectedMember,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";
import { projectMemberIdentity } from "../social/privacy";
import { canViewCopy } from "./canViewCopy";
import { ratingBreakdownOf } from "./definitionAggregates";

// Solve duration in whole MINUTES: the stored, explicit `completionTimeMinutes` ALWAYS wins (it's
// the domain's resolved duration — mirrors `Completion.resolveDuration`, which already picked
// explicit-vs-derived and applies the same-day => 1 day floor). The (endDate - startDate) diff is
// only a FALLBACK for legacy rows that predate persisting a duration. A non-positive fallback
// result means the span is unusable as a duration (e.g. a legacy same-day row) and returns null
// (unknown) rather than a misleading 0. Returned raw (not rounded to days) so the UI can humanize it
// (e.g. "2 hours", "1 day", "4 days", "1 week") instead of collapsing a sub-day solve to "0 days".
const finishMinutesOf = (c: {
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
}): number | null => {
  if (c.completionTimeMinutes != null) {
    return Math.round(c.completionTimeMinutes);
  }
  if (c.endDate != null) {
    const diff = Math.round((c.endDate - c.startDate) / 60000);
    return diff > 0 ? diff : null;
  }
  return null;
};

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

    // Copy-reachability gate (identical to browseOwnedPuzzles): the viewer may only see this copy if
    // they own it, the owner is public AND the copy is open, or the copy is circle-shared to them.
    // A private/unreachable copy of another member returns null — no personal data leaks.
    if (!(await canViewCopy(ctx, viewerId, copy))) return null;

    const viewerIsOwner = copy.ownerId === viewerId;

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

    // --- Type-grouped history (in addition to before/since), newest first. ---------------------
    const completedCompletions = completions.filter((c) => c.isCompleted);

    const completionsGrouped: CopyCompletionEntry[] = await Promise.all(
      completedCompletions
        .slice()
        .sort((a, b) => (b.endDate ?? b.startDate) - (a.endDate ?? a.startDate))
        .map(async (c) => ({
          solver: await project(c.userId),
          isYou: c.userId === viewerId,
          occurredAt: c.endDate ?? c.startDate,
          finishMinutes: finishMinutesOf(c),
        })),
    );

    const loansGrouped: CopyLoanEntry[] = await Promise.all(
      loans
        .slice()
        .sort((a, b) => b.openedAt - a.openedAt)
        .map(async (l) => ({
          lender: await project(l.lenderId),
          borrower: await project(l.borrowerId),
          openedAt: l.openedAt,
          closedAt: l.closedAt ?? null,
          status: l.status,
        })),
    );

    const transfersGrouped: CopyTransferEntry[] = await Promise.all(
      custodyEntries
        .slice()
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .map(async (e) => ({
          from: await project(e.previousOwner),
          to: await project(e.newOwner),
          viaExchange: e.exchangeId !== "" && e.exchangeId != null,
          occurredAt: e.occurredAt,
        })),
    );

    // --- Per-copy stats. -----------------------------------------------------------------------
    const finishMinutesList = completedCompletions
      .map(finishMinutesOf)
      .filter((d): d is number => d != null);
    const fastestFinishMinutes =
      finishMinutesList.length > 0 ? Math.min(...finishMinutesList) : null;

    // The viewer's own star-only review of THIS copy (one per member+copy), or null.
    const viewerCopyReview = await ctx.db
      .query("copyReviews")
      .withIndex("by_user_copy", (q) =>
        q.eq("userId", viewerId).eq("copyId", args.copyId),
      )
      .unique();

    const stats = {
      timesCompleted: completedCompletions.length,
      fastestFinishMinutes,
      timesLentOut: loans.length,
      yourCopyRating: viewerCopyReview?.rating ?? null,
    };

    // --- Copy reviews: star-only reviews of THIS copy, newest-updated first. -------------------
    // Authors go through the same projection memo (salt = copyId) as every other member on this
    // page, so a hidden reviewer stays anonymised and a vanished author gets the anon fallback.
    const copyReviewRows = await ctx.db
      .query("copyReviews")
      .withIndex("by_copy", (q) => q.eq("copyId", args.copyId))
      .collect();
    const copyReviews: CopyReviewEntry[] = await Promise.all(
      copyReviewRows
        // The index orders by _creationTime; the list contract is descending by updatedAt.
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(async (r) => ({
          author: await project(r.userId),
          rating: r.rating,
          updatedAt: r.updatedAt,
        })),
    );

    // --- Community rating: the DEFINITION-level puzzleReviews breakdown (shared helper — same
    // numbers as the catalog detail page). ------------------------------------------------------
    const community = await ratingBreakdownOf(ctx, copy.puzzleId);

    // --- Gallery: per-copy uploaded images, resolved to URLs, newest first. --------------------
    const imageRows = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", args.copyId))
      .collect();
    // Moderation gate: include a photo iff it's approved (absent status == legacy == approved), OR
    // it's the viewer's OWN pending upload (so they see their "pending review" photo). Rejected
    // photos — and other members' pending photos — are excluded for everyone.
    const visibleImageRows = imageRows.filter((img) => {
      const status = img.moderationStatus ?? "approved";
      if (status === "approved") return true;
      return status === "pending" && img.uploaderId === viewerId;
    });
    const galleryResolved = await Promise.all(
      visibleImageRows
        .slice()
        .sort((a, b) => (b.takenAt ?? b.createdAt) - (a.takenAt ?? a.createdAt))
        .map(async (img): Promise<CopyPhoto | null> => {
          const url = await ctx.storage.getUrl(img.fileId);
          if (!url) return null;
          // Resolve the uploader's display name (the lightbox shows who took the shot); null when
          // the user row vanished so an orphaned photo never breaks the gallery.
          const uploader = await ctx.db.get(img.uploaderId);
          return {
            id: img._id as string,
            url,
            caption: img.title ?? img.tag ?? null,
            tag: img.tag ?? null,
            description: img.description ?? null,
            uploaderName: uploader ? toMemberView(uploader).name : null,
            takenAt: img.takenAt ?? null,
            createdAt: img.createdAt,
            // Only "approved" or the viewer's own "pending" survive the filter above; an absent
            // status is legacy => approved.
            moderationStatus:
              (img.moderationStatus ?? "approved") === "pending"
                ? "pending"
                : "approved",
          };
        }),
    );
    const gallery: CopyPhoto[] = galleryResolved.filter(
      (p): p is CopyPhoto => p != null,
    );

    // --- Cover resolution. --------------------------------------------------------------------
    // The copy may pin one of its own photos as the cover; resolve it to a URL. Falls back to the
    // puzzle's global catalogue image when no cover is chosen, the image row vanished, its stored
    // file no longer resolves, or the cover isn't approved (mirrors resolveCoverUrl.ts's
    // approved-only rule — a rejected/pending cover must not render on the copy page). `coverImageId`
    // is null unless a cover both exists AND resolves so the picker only reports an active, usable
    // selection.
    // NOTE: the catalogue image is a _storage id, so it MUST be resolved via getUrl — emitting the
    // raw id renders a broken <img src>. (snapshot.thumbnail caches the same storage id.)
    const globalImage = puzzle?.image
      ? ((await ctx.storage.getUrl(puzzle.image)) ?? undefined)
      : undefined;
    let coverImage: string | undefined = globalImage;
    let coverImageId: string | null = null;
    if (copy.coverImageId) {
      const coverRow = await ctx.db.get(copy.coverImageId);
      if (
        coverRow &&
        coverRow.ownedPuzzleId === args.copyId &&
        (coverRow.moderationStatus ?? "approved") === "approved"
      ) {
        const coverUrl = await ctx.storage.getUrl(coverRow.fileId);
        if (coverUrl) {
          coverImage = coverUrl;
          coverImageId = coverRow._id as string;
        }
      }
    }

    return {
      copyId: copy._id,
      puzzleId: copy.puzzleId,
      // The domain CopyId — the copy-edit mutations (condition/sharing/details, recordCompletion)
      // key on this aggregateId, not the _id. Null for rows that predate the backfill.
      aggregateId: copy.aggregateId ?? null,
      viewerIsOwner,
      owner,
      snapshot: {
        title: copy.snapshot?.title ?? puzzle?.title ?? "Unknown Puzzle",
        brand: copy.snapshot?.brand ?? puzzle?.brand,
        pieceCount: copy.snapshot?.pieceCount ?? puzzle?.pieceCount ?? 0,
        image: coverImage,
        coverImageId,
        condition: copy.condition,
        // Owner-only personal fields (notes / acquisition provenance) are omitted for non-owners,
        // alongside the sale/acquisition price the DTO already never carries for them.
        notes: viewerIsOwner ? copy.notes : undefined,
        availability: copy.availability,
        acquisitionDate: viewerIsOwner ? copy.acquisitionDate : undefined,
        acquisitionSource: viewerIsOwner ? copy.acquisitionSource : undefined,
        difficulty: puzzle?.difficulty,
        tags: puzzle?.tags ?? [],
      },
      acquiredByViewerAt,
      since,
      before,
      completions: completionsGrouped,
      loans: loansGrouped,
      transfers: transfersGrouped,
      copyReviews,
      stats,
      community,
      gallery,
    };
  },
});
