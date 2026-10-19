import type {
  CopyCompletionEntry,
  CopyInstanceTimelineEntry,
  CopyInstanceView,
  CopyLoanEntry,
  CopyPhoto,
  CopyReviewEntry,
  CopyTransferEntry,
  PendingPhotoPlaceholder,
  ProjectedMember,
} from "@jigswap/contracts";
import { resolveHouseholdCopyPermission } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { copyAccessOf } from "../household/copyAccess";
import { personView } from "../household/getMyHousehold";
import { householdDefaultOf, membershipOf } from "../household/memberships";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { projectMemberIdentity } from "../social/privacy";
import { canViewCopy } from "./canViewCopy";
import { effectiveCopyVisibility } from "./copyVisibility";
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
    // Household access: a member the owner left at "manage" acts as co-owner (edit controls +
    // owner-only fields); "view" only sees the copy. Since/before tenure stays owner-only.
    // `owner` is the household person view (name/avatar, never email), the same one behind the
    // library's "Household · {owner}" badge, so the copy page names a housemate's copy's owner even
    // when the profile projection anonymises them.
    const access = await copyAccessOf(ctx, viewerId, copy);
    const viewerCanManage = access === "owner" || access === "manage";
    // The owner's household (the viewer's own when they are the owner) carries the default an
    // inheriting copy follows; the effective permission comes from the domain resolution helper.
    const ownerMembership =
      access === "none" ? null : await membershipOf(ctx, copy.ownerId);
    const householdDefault = ownerMembership
      ? await householdDefaultOf(ctx, ownerMembership.householdId)
      : undefined;
    const household = ownerMembership
      ? {
          permission: resolveHouseholdCopyPermission(
            copy.householdPermission,
            householdDefault,
          ),
          viewerAccess: access as "owner" | "manage" | "view",
          inheritsDefault: copy.householdPermission === undefined,
          householdDefault: resolveHouseholdCopyPermission(
            undefined,
            householdDefault,
          ),
          owner: await personView(ctx, copy.ownerId),
        }
      : null;

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
        datePrecision: c.datePrecision,
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
          datePrecision: c.datePrecision,
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
    // it's the viewer's OWN pending/unscored upload (so they see their "pending review" photo; an
    // unscored photo could not be checked yet and stays private until a re-screen). Rejected
    // photos — and other members' pending/unscored photos — are excluded for everyone. And no
    // photo is served, to anyone, before its CSAM hash check has passed (isHashCleared): until
    // then even the uploader gets a placeholder below.
    const visibleImageRows = imageRows.filter((img) => {
      if (!isHashCleared(img)) return false;
      const status = img.moderationStatus ?? "approved";
      if (status === "approved") return true;
      return (
        (status === "pending" || status === "unscored") &&
        img.uploaderId === viewerId
      );
    });
    const galleryResolved = await Promise.all(
      visibleImageRows
        .slice()
        .sort((a, b) => (b.takenAt ?? b.createdAt) - (a.takenAt ?? a.createdAt))
        .map(async (img): Promise<CopyPhoto | null> => {
          const url = await ctx.storage.getUrl(img.fileId);
          if (!url) return null;
          // The uploader (the lightbox shows who took the shot), projected like every other member
          // on this page: a hidden uploader (often the hidden owner) is never named.
          return {
            id: img._id as string,
            url,
            caption: img.title ?? img.tag ?? null,
            tag: img.tag ?? null,
            description: img.description ?? null,
            uploader: await project(img.uploaderId as string),
            takenAt: img.takenAt ?? null,
            createdAt: img.createdAt,
            // Only "approved" or the viewer's own "pending"/"unscored" survive the filter above;
            // both of the latter show as "pending" review. An absent status is legacy => approved.
            moderationStatus:
              (img.moderationStatus ?? "approved") === "approved"
                ? "approved"
                : "pending",
          };
        }),
    );
    const gallery: CopyPhoto[] = galleryResolved.filter(
      (p): p is CopyPhoto => p != null,
    );
    // Other members' photos still being screened: a blurhash placeholder only (lib/blurhash, 4x3,
    // too coarse to reveal content) — never a URL, storage id or row id. Rejected photos are not
    // listed at all, so a rejection leaves no trace for other viewers.
    // A photo whose hash check has not passed shows as a placeholder to everyone, the uploader
    // included, and without its blurhash.
    const pendingPhotos: PendingPhotoPlaceholder[] = imageRows
      .filter((img) => {
        const status = img.moderationStatus ?? "approved";
        if (
          status !== "approved" &&
          status !== "pending" &&
          status !== "unscored"
        ) {
          return false;
        }
        if (!isHashCleared(img)) return true;
        return status !== "approved" && img.uploaderId !== viewerId;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((img) => ({
        blurhash: isHashCleared(img) ? (img.blurhash ?? null) : null,
        createdAt: img.createdAt,
      }));

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
      ? ((await boxArtUrl(ctx, puzzle.image)) ?? undefined)
      : undefined;
    let coverImage: string | undefined = globalImage;
    let coverImageId: string | null = null;
    if (copy.coverImageId) {
      const coverRow = await ctx.db.get(copy.coverImageId);
      if (
        coverRow &&
        coverRow.ownedPuzzleId === args.copyId &&
        (coverRow.moderationStatus ?? "approved") === "approved" &&
        isHashCleared(coverRow)
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
      viewerCanManage,
      household,
      owner,
      snapshot: {
        title: copy.snapshot?.title ?? puzzle?.title ?? "Unknown Puzzle",
        brand: copy.snapshot?.brand ?? puzzle?.brand,
        pieceCount: copy.snapshot?.pieceCount ?? puzzle?.pieceCount ?? 0,
        image: coverImage,
        coverImageId,
        condition: copy.condition,
        // Owner-only personal fields (notes / acquisition provenance) are omitted for anyone who
        // can't manage the copy (a household "manage" member is a co-owner and may edit notes),
        // alongside the sale/acquisition price the DTO already never carries for them.
        notes: viewerCanManage ? copy.notes : undefined,
        availability: copy.availability,
        visibility: effectiveCopyVisibility(copy),
        acquisitionDate: viewerCanManage ? copy.acquisitionDate : undefined,
        acquisitionSource: viewerCanManage ? copy.acquisitionSource : undefined,
        difficulty: puzzle?.difficulty,
        tags: puzzle?.tags ?? [],
      },
      acquiredByViewerAt: viewerIsOwner ? acquiredByViewerAt : null,
      since,
      before,
      completions: completionsGrouped,
      loans: loansGrouped,
      transfers: transfersGrouped,
      copyReviews,
      stats,
      community,
      gallery,
      pendingPhotos,
    };
  },
});
