import type {
  NotificationActorView,
  NotificationView,
  NotificationViewContext,
} from "@jigswap/contracts";
import { COOLDOWN_MS, type NotificationSubject } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { projectTradeParty } from "../exchange/tradeParty";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { canViewCopy } from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import {
  ADMIN_NOTIFICATION_TYPES,
  decideFollowBack,
  decideFollowRequest,
  decideHouseholdInvite,
  decideMessage,
  INFORMATIONAL,
  INITIATOR_NOTIFICATION_TYPES,
  isActorRevealed,
  isActorSubjectType,
  messagePreviewOf,
  notificationHref,
  TRADE_NOTIFICATION_TYPES,
  UNAVAILABLE,
  withoutActionsWhenGrouped,
  type ViewDecision,
} from "./viewRules";

// The loading half of the notification read model: reads the live facts a row's refs point at and
// hands them to the pure rules in viewRules.ts. Shared by listMyNotificationViews and any other
// reader that must resolve the same actor/context/href/actions for one row (notifications.act, the
// rich email/push renderers). Every read is memoized in the per-request cache, so a page that names
// the same member or exchange many times loads it once.

/** Max actors carried per view (newest first). */
const MAX_ACTORS = 3;

export interface NotificationViewCache {
  /** Whether the viewer is an admin (JWT claim; pass false where there is no viewer identity). */
  readonly viewerIsAdmin: boolean;
  readonly memo: Map<string, Promise<unknown>>;
}

export const createNotificationViewCache = (opts: {
  viewerIsAdmin: boolean;
}): NotificationViewCache => ({
  viewerIsAdmin: opts.viewerIsAdmin,
  memo: new Map(),
});

const memoized = <T>(
  cache: NotificationViewCache,
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
  let hit = cache.memo.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    cache.memo.set(key, hit);
  }
  return hit;
};

// --- memoized loaders ---

const loadUser = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: Id<"users">,
) => memoized(cache, `user:${id}`, () => ctx.db.get(id));

const loadProfile = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  memberId: Id<"users">,
) =>
  memoized(cache, `profile:${memberId}`, () =>
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
  );

const follows = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  followerId: Id<"users">,
  followeeId: Id<"users">,
): Promise<boolean> =>
  memoized(cache, `follows:${followerId}>${followeeId}`, async () => {
    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", followerId).eq("followeeId", followeeId),
      )
      .first();
    return edge !== null;
  });

/**
 * A requester -> target pair's current follow request. A pair can hold several rows (a declined
 * request followed by a new one), so prefer the pending row, else the newest. Shared with
 * notifications.act so both target the same request.
 */
export const currentFollowRequest = async (
  ctx: QueryCtx,
  requesterId: Id<"users">,
  targetId: Id<"users">,
): Promise<Doc<"followRequests"> | null> => {
  const rows = await ctx.db
    .query("followRequests")
    .withIndex("by_requester_target", (q) =>
      q.eq("requesterId", requesterId).eq("targetId", targetId),
    )
    .collect();
  return (
    rows.find((row) => row.status === "pending") ??
    rows.reduce<Doc<"followRequests"> | null>(
      (newest, row) =>
        !newest || row.createdAt > newest.createdAt ? row : newest,
      null,
    )
  );
};

const latestRequest = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  requesterId: Id<"users">,
  targetId: Id<"users">,
) =>
  memoized(cache, `request:${requesterId}>${targetId}`, () =>
    currentFollowRequest(ctx, requesterId, targetId),
  );

// viewer -> target request reads as pending, with the same silent-decline masking as
// social/getFollowRelation (a declined request inside its cooldown, not cancelled, is "pending").
const requestPending = async (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  requesterId: Id<"users">,
  targetId: Id<"users">,
): Promise<boolean> => {
  const request = await latestRequest(ctx, cache, requesterId, targetId);
  if (!request) return false;
  if (request.status === "pending") return true;
  return (
    request.status === "declined" &&
    request.cancelledAt === undefined &&
    request.respondedAt !== undefined &&
    Date.now() - request.respondedAt < COOLDOWN_MS
  );
};

// The aggregate-id lookups the subjects need (exchange, thread, follow request, household invite,
// circle invite, circle).
const loadExchange = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: string,
) =>
  memoized(cache, `exchange:${id}`, () =>
    ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadThread = (ctx: QueryCtx, cache: NotificationViewCache, id: string) =>
  memoized(cache, `thread:${id}`, () =>
    ctx.db
      .query("threads")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadFollowRequest = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: string,
) =>
  memoized(cache, `followRequest:${id}`, () =>
    ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadHouseholdInvite = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: string,
) =>
  memoized(cache, `householdInvite:${id}`, () =>
    ctx.db
      .query("householdInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadConnectionOffer = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: string,
) =>
  memoized(cache, `connectionOffer:${id}`, () =>
    ctx.db
      .query("connectionOffers")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .unique(),
  );

const loadCircleInvite = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: string,
) =>
  memoized(cache, `circleInvite:${id}`, () =>
    ctx.db
      .query("circleInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadCircle = (ctx: QueryCtx, cache: NotificationViewCache, id: string) =>
  memoized(cache, `circle:${id}`, () =>
    ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
      .first(),
  );

const loadDoc = <T extends "puzzles" | "ownedPuzzles" | "goals">(
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: Id<T>,
) =>
  memoized(cache, `doc:${id}`, () => ctx.db.get(id)) as Promise<Doc<T> | null>;

const storageUrl = (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  id: Id<"_storage">,
) => memoized(cache, `storage:${id}`, () => ctx.storage.getUrl(id));

// --- actor projection ---

type ResolvedActor = {
  readonly view: NotificationActorView;
  /** The actor's handle when revealed; null when anonymous. */
  readonly handle: string | null;
};

const ANONYMOUS: ResolvedActor = { view: { anonymous: true }, handle: null };
const DEPARTED: ResolvedActor = {
  view: { anonymous: true, departed: true },
  handle: null,
};

const revealedActor = (
  user: Doc<"users">,
  profile: Doc<"profiles"> | null,
  tradeRevealed: boolean,
): ResolvedActor => {
  const handle = user.slug ?? user.username ?? user._id;
  const name = memberDisplayNameOf(user, profile);
  return {
    view: {
      anonymous: false,
      memberId: user._id,
      ...(name !== undefined ? { name } : {}),
      // A member revealed by the trade only gets the limited card: no avatar.
      ...(!tradeRevealed && user.avatar !== undefined
        ? { avatar: user.avatar }
        : {}),
      handle,
      ...(tradeRevealed ? { tradeRevealed: true as const } : {}),
    },
    handle,
  };
};

// The exchange a trade notification is about: its subject (aggregateId), else its relatedId (the
// exchange `_id`, on rows written before refs).
const tradeExchangeOf = async (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  row: Doc<"notifications">,
): Promise<Doc<"exchanges"> | null> => {
  const subject = row.subject as NotificationSubject | undefined;
  if (subject?.kind === "exchange") {
    return loadExchange(ctx, cache, subject.exchangeId);
  }
  const docId =
    row.relatedId !== undefined
      ? ctx.db.normalizeId("exchanges", row.relatedId)
      : null;
  return docId
    ? memoized(cache, `doc:${docId}`, () => ctx.db.get(docId))
    : null;
};

const resolveActor = async (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  viewerId: Id<"users">,
  row: Doc<"notifications">,
  actorId: Id<"users">,
  /** For message_received: the exchange its (exchange) thread is about, when it resolves. */
  messageExchange: Doc<"exchanges"> | null,
): Promise<ResolvedActor> => {
  const type = row.type;
  const user = await loadUser(ctx, cache, actorId);
  if (!user || !user.isActive) return DEPARTED;
  const profile = await loadProfile(ctx, cache, actorId);
  const isViewer = actorId === viewerId;

  // Trade types, and a message in an exchange thread: the per-trade rule for THAT exchange (only
  // when both are its parties).
  const exchange = TRADE_NOTIFICATION_TYPES.has(type)
    ? await tradeExchangeOf(ctx, cache, row)
    : messageExchange;
  if (exchange) {
    const isParty = (id: Id<"users">) =>
      exchange !== null &&
      (id === exchange.initiatorId || id === exchange.recipientId);
    if (exchange && isParty(actorId) && isParty(viewerId)) {
      const party = await projectTradeParty(ctx, viewerId, exchange, actorId);
      switch (party.state) {
        case "departed":
          return DEPARTED;
        case "hidden":
          return ANONYMOUS;
        case "tradeRevealed":
          return revealedActor(user, profile, true);
        default:
          return revealedActor(user, profile, false);
      }
    }
  }
  // Unresolvable exchange (or not both its parties): the ordinary public / mutual rule (fails
  // closed). A message's sender never gets the initiator reveal: a DM projects them like the
  // thread does, and an exchange-thread message the per-trade rule did not decide fails closed.
  const dmMessage = type === "message_received";
  // Only read the follow graph when the cheaper rules have not already decided.
  const preRevealed = isActorRevealed(
    type,
    {
      active: true,
      isViewer,
      isPublic: false,
      mutualFollowers: false,
      dmMessage,
    },
    cache.viewerIsAdmin,
  );
  const isPublic = (profile?.visibility ?? "public") === "public";
  const mutualFollowers =
    !preRevealed && !isPublic && !isViewer
      ? (await follows(ctx, cache, viewerId, actorId)) &&
        (await follows(ctx, cache, actorId, viewerId))
      : false;
  if (
    !isActorRevealed(
      type,
      { active: true, isViewer, isPublic, mutualFollowers, dmMessage },
      cache.viewerIsAdmin,
    )
  ) {
    return ANONYMOUS;
  }
  return revealedActor(user, profile, false);
};

// --- subject resolution ---

type SubjectFacts = {
  /** The subject exists and the viewer may see it. */
  readonly available: boolean;
  readonly context: NotificationViewContext;
  /** Type-specific live decision; undefined falls back to informational. */
  readonly decision?: ViewDecision;
};

const puzzleViewable = (
  puzzle: Doc<"puzzles">,
  viewerId: Id<"users">,
  viewerIsAdmin: boolean,
): boolean =>
  puzzle.status === "approved" ||
  viewerIsAdmin ||
  (puzzle.submittedBy === viewerId && puzzle.status !== "disabled");

// The title + cover of an owned copy, only when the viewer may see that copy.
const copyContext = async (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  viewerId: Id<"users">,
  copyId: Id<"ownedPuzzles">,
): Promise<NotificationViewContext | null> => {
  const copy = await loadDoc(ctx, cache, copyId);
  if (!copy) return null;
  const viewable = await memoized(cache, `canViewCopy:${copyId}`, () =>
    canViewCopy(ctx, viewerId, copy),
  );
  if (!viewable) return null;
  const puzzle = await loadDoc(ctx, cache, copy.puzzleId);
  const title = copy.snapshot?.title ?? puzzle?.title;
  const thumbnailUrl = await memoized(cache, `cover:${copyId}`, () =>
    resolveCopyCoverUrl(ctx, copy, puzzle),
  );
  return {
    ...(title !== undefined ? { puzzleTitle: title } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
};

const resolveSubject = async (
  ctx: QueryCtx,
  cache: NotificationViewCache,
  viewerId: Id<"users">,
  row: Doc<"notifications">,
  subject: NotificationSubject,
): Promise<SubjectFacts> => {
  const actorId = row.actorIds?.[0];
  switch (subject.kind) {
    case "exchange": {
      const exchange = await loadExchange(ctx, cache, subject.exchangeId);
      if (
        !exchange ||
        (exchange.initiatorId !== viewerId && exchange.recipientId !== viewerId)
      ) {
        return { available: false, context: {} };
      }
      const copy = await copyContext(
        ctx,
        cache,
        viewerId,
        exchange.requestedPuzzleId,
      );
      return {
        available: true,
        context: { ...copy, exchangeStatus: exchange.status },
      };
    }
    case "thread": {
      const thread = await loadThread(ctx, cache, subject.threadId);
      const isParticipant =
        thread !== null && thread.participants.includes(viewerId);
      if (!thread || !isParticipant) {
        return { available: false, context: {} };
      }
      const last = await memoized(
        cache,
        `lastMessage:${thread.aggregateId}`,
        () =>
          ctx.db
            .query("threadMessages")
            .withIndex("by_thread_sent", (q) =>
              q.eq("threadAggregateId", thread.aggregateId),
            )
            .order("desc")
            .first(),
      );
      const preview =
        last && last.kind === "text" && last.removedAt === undefined
          ? messagePreviewOf(last.body)
          : undefined;
      // A media message is described by its kind, never by its caption. Attachment-less (legacy)
      // image rows get neither: there is no real photo behind them.
      const messageKind =
        last &&
        last.removedAt === undefined &&
        (last.kind === "image" || last.kind === "location") &&
        last.attachmentId !== undefined
          ? last.kind
          : undefined;
      return {
        available: true,
        context: preview
          ? { messagePreview: preview }
          : messageKind
            ? { messageKind }
            : {},
        decision: decideMessage(true),
      };
    }
    case "followRequest": {
      if (!actorId) return { available: false, context: {} };
      // Prefer the stored request; a withdrawn-then-re-sent request has a new id, so fall back to
      // the pair's current row. Either way it must be actor -> viewer.
      const stored = await loadFollowRequest(ctx, cache, subject.requestId);
      const request =
        stored && stored.requesterId === actorId && stored.targetId === viewerId
          ? stored
          : await latestRequest(ctx, cache, actorId, viewerId);
      return {
        available: true,
        context: {},
        decision: decideFollowRequest({
          status: request?.status ?? null,
          viewerFollowsRequester: await follows(ctx, cache, viewerId, actorId),
        }),
      };
    }
    case "householdInvite": {
      const invite = await loadHouseholdInvite(ctx, cache, subject.inviteId);
      return {
        available: true,
        context: {},
        decision: decideHouseholdInvite(
          invite && invite.inviteeId === viewerId ? invite.status : null,
        ),
      };
    }
    // The invitee sees the circle's live name; the link stays live while the invite is open.
    case "circleInvite": {
      const invite = await loadCircleInvite(ctx, cache, subject.inviteId);
      if (!invite || invite.inviteeId !== viewerId) {
        return { available: false, context: {} };
      }
      const circle = await loadCircle(ctx, cache, invite.circleAggregateId);
      return {
        available: invite.status === "pending" && invite.expiresAt > Date.now(),
        context: circle ? { circleName: circle.name } : {},
      };
    }
    // Only a current member of the circle learns its live name.
    case "circle": {
      const circle = await loadCircle(ctx, cache, subject.circleId);
      return circle && circle.memberships.some((m) => m.memberId === viewerId)
        ? { available: true, context: { circleName: circle.name } }
        : { available: false, context: {} };
    }
    case "puzzle": {
      const puzzle = await loadDoc(
        ctx,
        cache,
        subject.puzzleId as Id<"puzzles">,
      );
      if (!puzzle || !puzzleViewable(puzzle, viewerId, cache.viewerIsAdmin)) {
        return { available: false, context: {} };
      }
      const thumbnailUrl = puzzle.image
        ? await storageUrl(ctx, cache, puzzle.image)
        : null;
      return {
        available: true,
        context: {
          puzzleTitle: puzzle.title,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        },
      };
    }
    case "copy": {
      const copy = await copyContext(
        ctx,
        cache,
        viewerId,
        subject.copyId as Id<"ownedPuzzles">,
      );
      return copy
        ? { available: true, context: copy }
        : { available: false, context: {} };
    }
    case "goal": {
      const goal = await loadDoc(ctx, cache, subject.goalId as Id<"goals">);
      return goal && goal.userId === viewerId
        ? { available: true, context: { goalTitle: goal.title } }
        : { available: false, context: {} };
    }
    // Household, review, change proposal and what's-new subjects carry nothing to resolve live:
    // their context is the params snapshot and their link is static.
    // Only while the offer is still open to the viewer (pending and unexpired, the same rule as
    // listMyConnectionOffers). Once declined, expired or accepted it is unavailable, and the view
    // drops the inviter's identity (see resolveNotificationView).
    case "connectionOffer": {
      const offer = await loadConnectionOffer(ctx, cache, subject.offerId);
      const open =
        offer !== null &&
        offer.toId === viewerId &&
        offer.status === "pending" &&
        offer.expiresAt > Date.now();
      return { available: open, context: {} };
    }
    default:
      return { available: true, context: {} };
  }
};

// The report-outcome params (report_decided, content_removed, member_warned), narrowed to the
// literals the contract allows; anything else is dropped.
const REPORT_DECISIONS = ["dismissed", "content_removed", "warned"] as const;
const RESTRICTED_CONTENT = ["message", "photo"] as const;
const GROUNDS = [
  "spam_scam",
  "harassment_hate",
  "sexual",
  "fake_trade",
  "illegal",
  "other",
] as const;
const oneOf = <T extends string>(
  allowed: readonly T[],
  value: string | undefined,
): T | undefined =>
  (allowed as readonly string[]).includes(value ?? "")
    ? (value as T)
    : undefined;

// Snapshot context from params: the fallback title when the live subject is unavailable (or the
// row has no subject), plus the immutable values (reason, rating, report outcome) that only live
// in params.
const paramsContext = (
  params: Record<string, string> | undefined,
): NotificationViewContext => {
  const rating = Number(params?.rating);
  const reportDecision = oneOf(REPORT_DECISIONS, params?.decision);
  const restrictedContent = oneOf(RESTRICTED_CONTENT, params?.restricted);
  const ground = oneOf(GROUNDS, params?.ground);
  return {
    ...(params?.puzzleTitle ? { puzzleTitle: params.puzzleTitle } : {}),
    ...(params?.goalTitle ? { goalTitle: params.goalTitle } : {}),
    ...(params?.reason ? { reason: params.reason } : {}),
    ...(params?.rating && Number.isFinite(rating) ? { rating } : {}),
    ...(reportDecision ? { reportDecision } : {}),
    ...(restrictedContent ? { restrictedContent } : {}),
    ...(ground ? { ground } : {}),
  };
};

/**
 * Resolve one notification row into the view `viewerId` sees, or null when the viewer must not see
 * it at all (someone else's row, or an admin type for a viewer who is no longer an admin).
 */
export const resolveNotificationView = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  row: Doc<"notifications">,
  cache: NotificationViewCache,
): Promise<NotificationView | null> => {
  if (row.userId !== viewerId) return null;
  if (ADMIN_NOTIFICATION_TYPES.has(row.type) && !cache.viewerIsAdmin) {
    return null;
  }

  const type = row.type;
  const actorIds = row.actorIds ?? [];
  const actorCount = Math.max(row.actorCount ?? 0, actorIds.length);
  const subject = row.subject as NotificationSubject | undefined;
  const hasRefs = row.actorIds !== undefined || subject !== undefined;

  // A message in an exchange thread is about that exchange: its sender is projected by the
  // per-trade rule. Anything else (a DM, or a thread / exchange that no longer resolves) is a
  // dmMessage: projected like the thread itself, never initiator-revealed (fails closed).
  const messageThreadId =
    subject?.kind === "thread" ? subject.threadId : row.relatedId;
  const messageThread =
    type === "message_received" && messageThreadId !== undefined
      ? await loadThread(ctx, cache, messageThreadId)
      : null;
  const messageExchangeId =
    messageThread?.subjectKind === "exchange"
      ? messageThread.exchangeId
      : undefined;
  const messageExchange = messageExchangeId
    ? await memoized(cache, `doc:${messageExchangeId}`, () =>
        ctx.db.get(messageExchangeId),
      )
    : null;
  const dmMessage = type === "message_received" && messageExchange === null;
  const actors = await Promise.all(
    actorIds
      .slice(0, MAX_ACTORS)
      .map((id) =>
        resolveActor(ctx, cache, viewerId, row, id, messageExchange),
      ),
  );
  const firstActor = actors[0] ?? null;

  const subjectFacts = subject
    ? await resolveSubject(ctx, cache, viewerId, row, subject)
    : null;

  // A connection offer names its inviter only while it is open: once it is answered or expired the
  // row stays as an unavailable, nameless "someone invited you" (no actor, no avatar, no handle).
  const hideActors =
    subject?.kind === "connectionOffer" && subjectFacts?.available === false;
  const shownActors = hideActors ? [] : actors;

  let decision: ViewDecision = INFORMATIONAL;
  if (subjectFacts && !subjectFacts.available) {
    decision = UNAVAILABLE;
  } else if (type === "new_follower" && actorCount > 1) {
    // A grouped row is informational: no follow back, and one gone follower does not make the
    // whole group unavailable.
    decision = INFORMATIONAL;
  } else if (isActorSubjectType(type)) {
    // Follow types: the actor is the subject. A gone (or legacy, ref-less) actor has nothing left
    // to act on.
    const actorId = actorIds[0];
    if (!actorId || !firstActor || firstActor.handle === null) {
      decision = hasRefs ? UNAVAILABLE : INFORMATIONAL;
    } else if (type === "follow_request_received") {
      decision = subjectFacts?.decision ?? INFORMATIONAL;
    } else if (type === "new_follower" || type === "follow_request_approved") {
      decision = decideFollowBack(type, {
        actorFollowsViewer: await follows(ctx, cache, actorId, viewerId),
        viewerFollowsActor: await follows(ctx, cache, viewerId, actorId),
        viewerRequestPending: await requestPending(
          ctx,
          cache,
          viewerId,
          actorId,
        ),
      });
    }
  } else if (subjectFacts?.decision) {
    decision = subjectFacts.decision;
  }
  decision = withoutActionsWhenGrouped(decision, actorCount);

  const context: NotificationViewContext = {
    ...paramsContext(row.params),
    ...subjectFacts?.context,
    // A row without actor refs (pre-refs, or the backfill could not derive one) has only the name
    // snapshot left. Initiator types reveal their actor to the viewer anyway, and the snapshot was
    // written with the same display-name rules (never an email).
    // trade_request's snapshot names the requester to the owner, who always sees them.
    // A DM message's sender is not initiator-revealed, so its snapshot never surfaces (fails
    // closed, like dmMessage itself).
    ...(actorIds.length === 0 &&
    (INITIATOR_NOTIFICATION_TYPES.has(type) || type === "trade_request") &&
    !dmMessage &&
    row.params?.actorName
      ? { actorNameSnapshot: row.params.actorName }
      : {}),
  };
  return {
    id: row.aggregateId ?? row._id,
    type,
    isRead: row.isRead,
    createdAt: row.updatedAt ?? row.createdAt,
    actors: shownActors.map((a) => a.view),
    actorCount: hideActors ? 0 : actorCount,
    context,
    href: notificationHref({
      type,
      relatedId: row.relatedId,
      subject,
      hasRefs,
      actorHandle: firstActor?.handle ?? null,
      actorCount,
      subjectAvailable: subjectFacts?.available ?? true,
    }),
    state: decision.state,
    ...(decision.resolvedAs !== undefined
      ? { resolvedAs: decision.resolvedAs }
      : {}),
    availableActions: [...decision.availableActions],
  };
};
