import {
  EXPORT_SECTIONS,
  type ExportPageView,
  type ExportRow,
  type ExportSection,
  type ProjectedMember,
} from "@jigswap/contracts";
import { COOLDOWN_MS } from "@jigswap/domain";
import type { PaginationOptions, PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { messageAttachmentViews } from "../conversation/messageAttachments";
import { threadRowByAggregateId } from "../conversation/readModelHelpers";
import { locationAttachmentViewOf } from "../conversation/sharedLocations";
import {
  projectTradeParty,
  tradePartyMemberView,
  type TradePartyMemo,
} from "../exchange/tradeParty";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { effectiveCopyVisibility } from "../library/copyVisibility";
import { toProjectedLoanView } from "../library/loanReadViews";
import { preferenceOrDefault } from "../notifications/adapters/convexNotificationPreferenceRepository";
import {
  onboardingRowOf,
  quickStartStateOf,
} from "../onboarding/memberOnboarding";
import { blockedEitherWaySet } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { toFollowEdgeView } from "../social/readViews";
import { resolvePhotoItems } from "../solving/listMyCompletions";

// The member's data export (GDPR Art. 15/20, SEC-66), read one section and one page at a time so
// no single query reads more than a bounded slice of a large history; the client walks every
// section of @jigswap/contracts EXPORT_SECTIONS to its end and builds the download.
//
// What a section may carry:
// - only the caller's own rows, found through an index on the caller's id (requireMember first,
//   never a client-supplied id);
// - an explicit allow-list of fields per row, never a spread document: internal bookkeeping
//   (moderation scores, hash-check state, push keys) stays out, and so does every raw _storage id.
//   Photos and box art are URLs, issued under the same gates as the app's own reads; a photo the
//   app does not show its uploader (rejected or quarantined, which read exactly alike) has none;
// - other members only as the app shows them to the caller: projectMemberIdentity, the per-trade
//   projectTradeParty, or the follow lists' toFollowEdgeView, never their raw users fields.

/** Rows per page: one page reads at most this many rows of its section (plus their joins). */
export const EXPORT_PAGE_SIZE = 200;

type SectionReader = (
  ctx: QueryCtx,
  me: Id<"users">,
  page: PaginationOptions,
) => Promise<ExportPageView>;

const pageOf = async <D>(
  result: PaginationResult<D>,
  toRow: (row: D) => Promise<ExportRow | null> | ExportRow | null,
): Promise<ExportPageView> => ({
  rows: (await Promise.all(result.page.map(async (row) => toRow(row)))).filter(
    (row): row is ExportRow => row !== null,
  ),
  continueCursor: result.continueCursor,
  isDone: result.isDone,
});

const onePage = (rows: ExportRow[]): ExportPageView => ({
  rows,
  continueCursor: "",
  isDone: true,
});

/** Another member as the caller sees them: named, hidden, or gone. */
type ExportPerson =
  { memberId: string; name?: string } | { hidden: true } | { departed: true };

const personOf = (projected: ProjectedMember): ExportPerson => {
  if (!projected.anonymous) {
    return {
      memberId: projected.member._id as string,
      name: memberDisplayNameOf(projected.member),
    };
  }
  return projected.departed ? { departed: true } : { hidden: true };
};

// The anonymous reference projectMemberIdentity salts is not exported, so one salt serves all.
const SALT = "export";

const projectedPerson = async (
  ctx: QueryCtx,
  me: Id<"users">,
  other: Id<"users">,
): Promise<ExportPerson> =>
  personOf(await projectMemberIdentity(ctx, me, other, SALT));

/** A party of an exchange, through the per-trade rule (a hidden owner stays hidden). */
const tradePerson = async (
  ctx: QueryCtx,
  me: Id<"users">,
  exchange: Doc<"exchanges">,
  party: Id<"users">,
  memo: TradePartyMemo,
): Promise<ExportPerson> => {
  const projected = await projectTradeParty(ctx, me, exchange, party, memo);
  const member = tradePartyMemberView(projected);
  if (member) {
    return {
      memberId: member._id as string,
      name: memberDisplayNameOf(member),
    };
  }
  return projected.state === "departed" ? { departed: true } : { hidden: true };
};

/** A partner review's other party, through the trade it reviews. */
const reviewPerson = async (
  ctx: QueryCtx,
  me: Id<"users">,
  exchangeId: Id<"exchanges">,
  party: Id<"users">,
  memo: TradePartyMemo,
): Promise<ExportPerson> => {
  const exchange = await ctx.db.get(exchangeId);
  return exchange
    ? tradePerson(ctx, me, exchange, party, memo)
    : projectedPerson(ctx, me, party);
};

/** A follow-list entry's member, as the follow lists show them (display name). */
const followPerson = async (
  ctx: QueryCtx,
  member: Id<"users">,
  createdAt: number,
): Promise<ExportPerson> => {
  const edge = await toFollowEdgeView(ctx, undefined, member, createdAt);
  return { memberId: edge.memberId as string, name: edge.displayName };
};

/** Memoized catalog puzzles, so a page of rows about the same puzzle reads it once. */
const puzzleReader = (ctx: QueryCtx) => {
  const memo = new Map<Id<"puzzles">, Promise<Doc<"puzzles"> | null>>();
  return (id: Id<"puzzles"> | undefined): Promise<Doc<"puzzles"> | null> => {
    if (!id) return Promise.resolve(null);
    let puzzle = memo.get(id);
    if (!puzzle) {
      puzzle = ctx.db.get(id);
      memo.set(id, puzzle);
    }
    return puzzle;
  };
};

const puzzleTitles = (ctx: QueryCtx) => {
  const puzzleOf = puzzleReader(ctx);
  return async (id: Id<"puzzles"> | undefined) => (await puzzleOf(id))?.title;
};

const exchangeRow = async (
  ctx: QueryCtx,
  me: Id<"users">,
  exchange: Doc<"exchanges">,
  memo: TradePartyMemo,
): Promise<ExportRow> => {
  const counterparty =
    exchange.initiatorId === me ? exchange.recipientId : exchange.initiatorId;
  return {
    id: exchange._id,
    type: exchange.type,
    status: exchange.status,
    requestedCopyId: exchange.requestedPuzzleId,
    offeredCopyId: exchange.offeredPuzzleId,
    salePrice: exchange.salePrice,
    loanReturnDate: exchange.loanReturnDate,
    proposerConfirmedAt: exchange.initiatorConfirmationTimestamp,
    ownerConfirmedAt: exchange.recipientConfirmationTimestamp,
    createdAt: exchange.createdAt,
    updatedAt: exchange.updatedAt,
    counterparty: await tradePerson(ctx, me, exchange, counterparty, memo),
  };
};

const loanRow = async (
  ctx: QueryCtx,
  me: Id<"users">,
  loan: Doc<"loans">,
): Promise<ExportRow> => {
  const view = await toProjectedLoanView(ctx, loan, me, SALT);
  const lent = loan.lenderId === me;
  return {
    id: view.loanId,
    copyId: view.copyDocId || undefined,
    puzzleTitle: view.puzzleTitle,
    status: view.status,
    openedAt: view.openedAt,
    expectedReturn: view.expectedReturn,
    closedAt: view.closedAt,
    ...(lent
      ? { borrower: personOf(view.borrower) }
      : { lender: personOf(view.lender) }),
  };
};

/** A change proposal's field diff with its box art as a URL (null when it may not be served). */
const proposalFieldsOf = async (
  ctx: QueryCtx,
  fields: Doc<"puzzleChangeProposals">["changes"],
): Promise<ExportRow> => {
  const { image, ...rest } = fields;
  return image === undefined
    ? rest
    : { ...rest, imageUrl: await boxArtUrl(ctx, image) };
};

/** The follow request statuses the requester sees: a decline never shows (getFollowRelation). */
const requesterStatusOf = (
  request: Doc<"followRequests">,
  now: number,
): "pending" | "approved" | null => {
  if (request.status === "approved") return "approved";
  if (request.status === "pending") return "pending";
  // Declined: masked as pending in its cooldown unless the requester cancelled, then no request.
  return request.cancelledAt === undefined &&
    request.respondedAt !== undefined &&
    now - request.respondedAt < COOLDOWN_MS
    ? "pending"
    : null;
};

const pushServiceOf = (endpoint: string): string | undefined => {
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
};

const SECTIONS: Record<ExportSection, SectionReader> = {
  account: async (ctx, me) => {
    const [
      user,
      profile,
      notifications,
      solving,
      presence,
      onboarding,
      reputation,
    ] = await Promise.all([
      ctx.db.get(me),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .first(),
      preferenceOrDefault(ctx, me),
      ctx.db
        .query("solvingPreferences")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .first(),
      ctx.db
        .query("presencePreferences")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .first(),
      onboardingRowOf(ctx, me),
      ctx.db
        .query("reputationProfiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .first(),
    ]);
    return onePage([
      {
        user: user && {
          email: user.email,
          name: user.name,
          username: user.username,
          slug: user.slug,
          avatar: user.avatar,
          bio: user.bio,
          location: user.location,
          preferredLanguage: user.preferredLanguage,
          shareAvatarPublicly: user.shareAvatarPublicly ?? false,
          createdAt: user.createdAt,
        },
        profile: {
          displayName: profile?.displayName,
          bio: profile?.bio,
          visibility: profile?.visibility ?? "public",
          featuredCopyIds: profile?.featuredCopyIds,
        },
        notifications: {
          channels: notifications.resolvedToggles(),
          messagePreviews: notifications.resolvedMessagePreviews(),
        },
        solving: solving && {
          trackCompletionDuration: solving.trackCompletionDuration,
          shareInProgress: solving.shareInProgress,
        },
        presence: presence && {
          share: presence.share,
          override: presence.override,
        },
        quickStart: onboarding && quickStartStateOf(onboarding),
        reputation: reputation && {
          averageRating: reputation.averageRating,
          reviewCount: reputation.reviewCount,
        },
      },
    ]);
  },

  // The browsers/devices push notifications go to: the push service only, never its keys.
  pushDevices: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      (row) => ({
        service: pushServiceOf(row.endpoint),
        createdAt: row.createdAt,
      }),
    ),

  // The member's copies; which of their collections each is in rides here (bounded per copy).
  copies: async (ctx, me, page) => {
    const puzzleOf = puzzleReader(ctx);
    return pageOf(
      await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", me))
        .paginate(page),
      async (copy) => {
        const memberships = await ctx.db
          .query("collectionMembers")
          .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy._id))
          .collect();
        // The copy's catalog snapshot, else (legacy rows) the puzzle itself.
        const shown = copy.snapshot ?? (await puzzleOf(copy.puzzleId));
        return {
          id: copy._id,
          puzzleId: copy.puzzleId,
          title: shown?.title,
          brand: shown?.brand,
          pieceCount: shown?.pieceCount,
          condition: copy.condition,
          missingPiecesCount: copy.missingPiecesCount,
          notes: copy.notes,
          coverPhotoId: copy.coverImageId,
          availability: copy.availability,
          visibility: effectiveCopyVisibility(copy),
          salePrice: copy.salePrice,
          acquisitionDate: copy.acquisitionDate,
          acquisitionSource: copy.acquisitionSource,
          acquisitionPrice: copy.acquisitionPrice,
          householdPermission: copy.householdPermission,
          lentOut: copy.heldBy !== undefined && copy.heldBy !== copy.ownerId,
          collectionIds: memberships.map((m) => m.collectionId),
          createdAt: copy.createdAt,
          updatedAt: copy.updatedAt,
        };
      },
    );
  },

  // Photos the member uploaded to a copy. Served like the copy gallery serves its uploader:
  // approved, or their own photo still being checked once its hash check has passed. A photo
  // the check stopped (rejected or quarantined, never told apart) is listed without an image.
  copyPhotos: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_uploader", (q) => q.eq("uploaderId", me))
        .paginate(page),
      async (img) => {
        const moderation = img.moderationStatus ?? "approved";
        const status =
          moderation === "approved"
            ? "approved"
            : moderation === "pending" || moderation === "unscored"
              ? "pending"
              : "notShown";
        const url =
          status !== "notShown" && isHashCleared(img)
            ? await ctx.storage.getUrl(img.fileId)
            : null;
        return {
          id: img._id,
          copyId: img.ownedPuzzleId,
          title: img.title,
          description: img.description,
          tag: img.tag,
          takenAt: img.takenAt,
          createdAt: img.createdAt,
          status,
          ...(url !== null && { url }),
        };
      },
    ),

  completions: async (ctx, me, page) => {
    const titleOf = puzzleTitles(ctx);
    return pageOf(
      await ctx.db
        .query("completions")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      async (c) => ({
        id: c.aggregateId ?? c._id,
        puzzleId: c.puzzleId,
        puzzleTitle: c.copySnapshot?.title ?? (await titleOf(c.puzzleId)),
        copyId: c.ownedPuzzleId,
        isCompleted: c.isCompleted,
        startDate: c.startDate,
        endDate: c.endDate,
        datePrecision: c.datePrecision ?? "day",
        completionTimeMinutes: c.completionTimeMinutes,
        allPiecesPresent: c.allPiecesPresent,
        notes: c.notes,
        // The copy as it was when solved; whose copy it was is not repeated here.
        copy: c.copySnapshot && {
          title: c.copySnapshot.title,
          brand: c.copySnapshot.brand,
          pieceCount: c.copySnapshot.pieceCount,
          condition: c.copySnapshot.condition,
          missingPiecesCount: c.copySnapshot.missingPiecesCount,
          borrowed: c.copySnapshot.wasBorrowed,
        },
        // The photo and its state: its small tile's srcSet is no data of theirs.
        photos: (await resolvePhotoItems(ctx, c)).map(({ url, pending }) => ({
          url,
          pending,
        })),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }),
    );
  },

  // Which copies a collection holds is on each copy (copies.collectionIds).
  collections: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("collections")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      (c) => ({
        id: c._id,
        name: c.name,
        description: c.description,
        visibility: c.visibility,
        color: c.color,
        icon: c.icon,
        isDefault: c.isDefault,
        isWishlist: c.isWishlist ?? false,
        wishedPuzzleIds: c.wishedDefinitions,
        personalNotes: c.personalNotes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }),
    ),

  categories: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("categories")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      (c) => ({
        id: c._id,
        name: c.name,
        color: c.color,
        description: c.description,
        isDefault: c.isDefault,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }),
    ),

  goals: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("goals")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      (g) => ({
        id: g._id,
        title: g.title,
        description: g.description,
        targetCompletions: g.targetCompletions,
        currentCompletions: g.currentCompletions,
        targetDate: g.targetDate,
        isActive: g.isActive,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      }),
    ),

  favorites: async (ctx, me, page) => {
    const titleOf = puzzleTitles(ctx);
    return pageOf(
      await ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", me))
        .paginate(page),
      async (f) => ({
        puzzleId: f.puzzleId,
        puzzleTitle: await titleOf(f.puzzleId),
        createdAt: f.createdAt,
      }),
    );
  },

  puzzleReviews: async (ctx, me, page) => {
    const titleOf = puzzleTitles(ctx);
    return pageOf(
      await ctx.db
        .query("puzzleReviews")
        .withIndex("by_user_puzzle", (q) => q.eq("userId", me))
        .paginate(page),
      async (r) => ({
        puzzleId: r.puzzleId,
        puzzleTitle: await titleOf(r.puzzleId),
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }),
    );
  },

  copyReviews: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("copyReviews")
        .withIndex("by_user_copy", (q) => q.eq("userId", me))
        .paginate(page),
      (r) => ({
        copyId: r.copyId,
        rating: r.rating,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }),
    ),

  partnerReviewsGiven: async (ctx, me, page) => {
    const memo: TradePartyMemo = new Map();
    return pageOf(
      await ctx.db
        .query("reviews")
        .withIndex("by_reviewer", (q) => q.eq("reviewerId", me))
        .paginate(page),
      async (r) => ({
        exchangeId: r.exchangeId,
        rating: r.rating,
        categories: r.categories,
        comment: r.comment,
        createdAt: r.createdAt,
        reviewee: await reviewPerson(ctx, me, r.exchangeId, r.revieweeId, memo),
      }),
    );
  },

  partnerReviewsReceived: async (ctx, me, page) => {
    const memo: TradePartyMemo = new Map();
    return pageOf(
      await ctx.db
        .query("reviews")
        .withIndex("by_reviewee", (q) => q.eq("revieweeId", me))
        .paginate(page),
      async (r) => ({
        exchangeId: r.exchangeId,
        rating: r.rating,
        categories: r.categories,
        comment: r.comment,
        createdAt: r.createdAt,
        reviewer: await reviewPerson(ctx, me, r.exchangeId, r.reviewerId, memo),
      }),
    );
  },

  puzzleComments: async (ctx, me, page) => {
    const titleOf = puzzleTitles(ctx);
    return pageOf(
      await ctx.db
        .query("puzzleComments")
        .withIndex("by_author", (q) => q.eq("authorId", me))
        .paginate(page),
      async (c) => ({
        id: c.aggregateId ?? c._id,
        puzzleId: c.puzzleId,
        puzzleTitle: await titleOf(c.puzzleId),
        copyId: c.copyId,
        text: c.text,
        createdAt: c.createdAt,
      }),
    );
  },

  photoComments: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("photoComments")
        .withIndex("by_author", (q) => q.eq("authorId", me))
        .paginate(page),
      (c) => ({
        id: c.aggregateId ?? c._id,
        photoId: c.photoId,
        text: c.text,
        createdAt: c.createdAt,
      }),
    ),

  exchangesProposed: async (ctx, me, page) => {
    const memo: TradePartyMemo = new Map();
    return pageOf(
      await ctx.db
        .query("exchanges")
        .withIndex("by_initiator", (q) => q.eq("initiatorId", me))
        .paginate(page),
      (exchange) => exchangeRow(ctx, me, exchange, memo),
    );
  },

  exchangesReceived: async (ctx, me, page) => {
    const memo: TradePartyMemo = new Map();
    return pageOf(
      await ctx.db
        .query("exchanges")
        .withIndex("by_recipient", (q) => q.eq("recipientId", me))
        .paginate(page),
      (exchange) => exchangeRow(ctx, me, exchange, memo),
    );
  },

  loansLent: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("loans")
        .withIndex("by_lender", (q) => q.eq("lenderId", me))
        .paginate(page),
      (loan) => loanRow(ctx, me, loan),
    ),

  loansBorrowed: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", me))
        .paginate(page),
      (loan) => loanRow(ctx, me, loan),
    ),

  changeProposals: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("puzzleChangeProposals")
        .withIndex("by_proposer", (q) => q.eq("proposedBy", me))
        .paginate(page),
      async (p) => ({
        id: p.aggregateId,
        puzzleId: p.puzzleDefinitionId,
        status: p.status,
        changes: await proposalFieldsOf(ctx, p.changes),
        baseline: await proposalFieldsOf(ctx, p.baseline),
        comment: p.comment,
        rejectionReason: p.rejectionReason,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        decidedAt: p.decidedAt,
      }),
    ),

  submittedPuzzles: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("puzzles")
        .withIndex("by_submitted_by", (q) => q.eq("submittedBy", me))
        .paginate(page),
      async (p) => ({
        id: p.aggregateId ?? p._id,
        title: p.title,
        description: p.description,
        brand: p.brand,
        publisher: p.publisher,
        pieceCount: p.pieceCount,
        artist: p.artist,
        series: p.series,
        ean: p.ean,
        upc: p.upc,
        modelNumber: p.modelNumber,
        dimensions: p.dimensions,
        shape: p.shape,
        difficulty: p.difficulty,
        tags: p.tags,
        status: p.status,
        ...(p.image !== undefined && {
          imageUrl: await boxArtUrl(ctx, p.image),
        }),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }),
    ),

  // The follow lists, as listFollowees / listFollowers show them: blocked pairs left out.
  following: async (ctx, me, page) => {
    const blocked = await blockedEitherWaySet(ctx, me);
    return pageOf(
      await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", me))
        .paginate(page),
      async (f) =>
        blocked.has(f.followeeId)
          ? null
          : {
              member: await followPerson(ctx, f.followeeId, f.createdAt),
              since: f.createdAt,
            },
    );
  },

  followers: async (ctx, me, page) => {
    const blocked = await blockedEitherWaySet(ctx, me);
    return pageOf(
      await ctx.db
        .query("follows")
        .withIndex("by_followee", (q) => q.eq("followeeId", me))
        .paginate(page),
      async (f) =>
        blocked.has(f.followerId)
          ? null
          : {
              member: await followPerson(ctx, f.followerId, f.createdAt),
              since: f.createdAt,
            },
    );
  },

  // Requests the member sent, exactly as getFollowRelation shows them: a decline reads as
  // pending through its cooldown and is gone after it (or once cancelled). No response time.
  followRequestsSent: async (ctx, me, page) => {
    const blocked = await blockedEitherWaySet(ctx, me);
    const now = Date.now();
    return pageOf(
      await ctx.db
        .query("followRequests")
        .withIndex("by_requester", (q) => q.eq("requesterId", me))
        .paginate(page),
      async (r) => {
        const status = requesterStatusOf(r, now);
        if (status === null || blocked.has(r.targetId)) return null;
        return {
          to: await followPerson(ctx, r.targetId, r.createdAt),
          status,
          requestedAt: r.createdAt,
        };
      },
    );
  },

  followRequestsReceived: async (ctx, me, page) => {
    const blocked = await blockedEitherWaySet(ctx, me);
    return pageOf(
      await ctx.db
        .query("followRequests")
        .withIndex("by_target", (q) => q.eq("targetId", me))
        .paginate(page),
      async (r) =>
        blocked.has(r.requesterId)
          ? null
          : {
              from: await followPerson(ctx, r.requesterId, r.createdAt),
              status: r.status,
              requestedAt: r.createdAt,
              respondedAt: r.respondedAt,
            },
    );
  },

  blocks: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("blocks")
        .withIndex("by_blocker", (q) => q.eq("blockerId", me))
        .paginate(page),
      async (b) => ({
        member: await projectedPerson(ctx, me, b.blockedId),
        blockedAt: b.createdAt,
      }),
    ),

  circles: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("circleMembers")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .paginate(page),
      async (seat) => {
        const circle = await ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", seat.circleAggregateId),
          )
          .first();
        if (!circle) return null;
        const membership = circle.memberships.find((m) => m.memberId === me);
        return {
          id: seat.circleAggregateId,
          name: circle.name,
          isOwner: circle.ownerId === me,
          permission: membership?.permission,
          joinedAt: membership?.joinedAt,
          createdAt: circle.createdAt,
        };
      },
    ),

  household: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("householdMembers")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .paginate(page),
      async (seat) => {
        const household = await ctx.db
          .query("households")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", seat.householdId),
          )
          .first();
        return {
          id: seat.householdId,
          name: household?.name,
          role: seat.role,
          joinedAt: seat.joinedAt,
          defaultCopyPermission: household?.defaultCopyPermission ?? "manage",
        };
      },
    ),

  // The member's conversations: their own state in each, and who a DM is with (as the inbox
  // shows them). An exchange thread points at its exchange, where the per-trade rule names the
  // other party; a circle thread at its circle.
  threads: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("threadParticipants")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .paginate(page),
      async (seat) => {
        const thread = await threadRowByAggregateId(
          ctx,
          seat.threadAggregateId,
        );
        if (!thread) return null;
        return {
          id: thread.aggregateId,
          kind: thread.subjectKind,
          exchangeId: thread.exchangeId,
          circleId: thread.circleId,
          ...(thread.subjectKind === "dm" && {
            with: await Promise.all(
              thread.participants
                .filter((p) => p !== me)
                .map((p) => projectedPerson(ctx, me, p)),
            ),
          }),
          createdAt: thread.createdAt,
          lastMessageAt: thread.lastMessageAt,
          lastReadAt: seat.lastReadAt,
          joinedAt: seat.joinedAt,
          muted: seat.muted ?? false,
        };
      },
    ),

  // Messages the member wrote (other participants' messages are theirs, not exported here).
  messagesSent: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("threadMessages")
        .withIndex("by_author", (q) => q.eq("authorId", me))
        .paginate(page),
      (m) => ({
        threadId: m.threadAggregateId,
        id: m.messageId,
        kind: m.kind,
        body: m.body,
        sentAt: m.sentAt,
        copyId: m.copyId,
        attachmentId: m.attachmentId,
        ...(m.removedAt !== undefined && { removedByModerator: true }),
      }),
    ),

  // Photos and places the member sent, as the thread shows them to their sender: a stopped photo
  // is the refusal card (identical for rejected and quarantined), never an image. A photo hidden
  // from its sender is not theirs to see any more and is left out, as every sender read does.
  attachmentsSent: async (ctx, me, page) => {
    const imageView = messageAttachmentViews(ctx, me);
    return pageOf(
      await ctx.db
        .query("messageAttachments")
        .withIndex("by_uploader", (q) => q.eq("uploaderId", me))
        .paginate(page),
      async (row) => {
        const base = {
          id: row._id,
          threadId: row.threadAggregateId,
          messageId: row.messageId,
          caption: row.caption,
          createdAt: row.createdAt,
        };
        if (row.kind === "location") {
          const view = await locationAttachmentViewOf(ctx, row._id);
          return {
            ...base,
            kind: "location",
            ...(view
              ? {
                  lat: view.lat,
                  lng: view.lng,
                  precision: view.precision,
                  label: view.label,
                  mapUrl: view.mapUrl,
                }
              : { removed: true }),
          };
        }
        if (row.hiddenFromSender) return null;
        const view = await imageView(row._id);
        const url = view.url ?? view.thumbUrl;
        return {
          ...base,
          kind: "image",
          status: view.status,
          reason: view.reason,
          review: view.review,
          ...(url !== undefined && { url }),
        };
      },
    );
  },

  // Reports the member filed, as listMyReports shows them plus what they wrote. The evidence
  // snapshot (other members' messages) and the statement of reasons (the reported member's
  // notice) are not the reporter's.
  reportsFiled: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("reports")
        .withIndex("by_reporter_created", (q) => q.eq("reporterId", me))
        .paginate(page),
      (r) => ({
        id: r._id,
        targetKind: r.targetKind,
        targetId: r.targetId,
        reason: r.reason,
        details: r.details,
        illegalNotice: r.illegalNotice && {
          notifierName: r.illegalNotice.notifierName,
          notifierEmail: r.illegalNotice.notifierEmail,
        },
        status: r.status,
        decision: r.decision,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      }),
    ),

  // Email invitations store no address, so none is exported.
  emailInvitesSent: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("emailInvites")
        .withIndex("by_inviter", (q) => q.eq("inviterId", me))
        .paginate(page),
      (i) => ({
        id: i.aggregateId,
        kind: i.kind,
        householdId: i.householdId,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
      }),
    ),

  inviteLinks: async (ctx, me, page) =>
    pageOf(
      await ctx.db
        .query("inviteLinks")
        .withIndex("by_owner", (q) => q.eq("ownerId", me))
        .paginate(page),
      async (link) => ({
        token: link.token,
        kind: link.context?.kind ?? "network",
        householdId: link.context?.householdId,
        createdAt: link.createdAt,
        revokedAt: link.revokedAt,
        expiresAt: link.expiresAt,
        consumedAt: link.consumedAt,
        ...(link.consumedBy !== undefined && {
          consumedBy: await projectedPerson(ctx, me, link.consumedBy),
        }),
        landingViews: link.landingViews,
        signupsAttributed: link.signupsAttributed,
        followsEstablished: link.followsEstablished,
      }),
    ),
};

// One page of one section of the caller's data export. Walk each section of EXPORT_SECTIONS from
// `cursor: null`, passing `continueCursor` back until `isDone`; a cursor belongs to its section.
export const exportUserDataPage = query({
  args: {
    section: v.union(...EXPORT_SECTIONS.map((section) => v.literal(section))),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { section, cursor }): Promise<ExportPageView> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    return SECTIONS[section](ctx, me, { cursor, numItems: EXPORT_PAGE_SIZE });
  },
});
