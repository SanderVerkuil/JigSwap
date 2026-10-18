import { ConversationApplicationError, type MemberId } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { cannotReplyError, toConvexError } from "../conversation/errors";

// Member blocks (spec 2.6): the read-side helpers every gate shares. A block is silent and works
// both ways, so gates ask "blocked either way" and refuse with the SAME generic error a lost
// connection gets (NotConnected), never a block-specific one. Posting to an existing thread
// refuses with the generic CannotReply instead (see assertThreadNotBlocked).

type Member = Id<"users"> | MemberId;
const asUserId = (m: Member) => m as unknown as Id<"users">;

const blocked = async (ctx: QueryCtx, blocker: Member, target: Member) =>
  (await ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) =>
      q.eq("blockerId", asUserId(blocker)).eq("blockedId", asUserId(target)),
    )
    .first()) !== null;

/** True when either member has blocked the other. */
export const isBlockedEitherWay = async (
  ctx: QueryCtx,
  a: Member,
  b: Member,
): Promise<boolean> => (await blocked(ctx, a, b)) || (await blocked(ctx, b, a));

/**
 * The block between `me` and `other` from `me`'s side: "byMe" when I blocked them (also when the
 * block is mutual, so I can still unblock), "byThem" when only they blocked me, else undefined.
 */
export const blockStateBetween = async (
  ctx: QueryCtx,
  me: Member,
  other: Member,
): Promise<"byMe" | "byThem" | undefined> => {
  if (await blocked(ctx, me, other)) return "byMe";
  if (await blocked(ctx, other, me)) return "byThem";
  return undefined;
};

/** Every member the viewer blocked or was blocked by, for filtering lists. */
export const blockedEitherWaySet = async (
  ctx: QueryCtx,
  viewer: Member,
): Promise<Set<Id<"users">>> => {
  const mine = await ctx.db
    .query("blocks")
    .withIndex("by_blocker", (q) => q.eq("blockerId", asUserId(viewer)))
    .collect();
  const theirs = await ctx.db
    .query("blocks")
    .withIndex("by_blocked", (q) => q.eq("blockedId", asUserId(viewer)))
    .collect();
  return new Set([
    ...mine.map((row) => row.blockedId),
    ...theirs.map((row) => row.blockerId),
  ]);
};

/** Throw openDmThread's own NotConnected refusal when the pair is blocked either way. */
export const assertPairNotBlocked = async (
  ctx: QueryCtx,
  a: Member,
  b: Member,
): Promise<void> => {
  if (await isBlockedEitherWay(ctx, a, b)) {
    throw toConvexError(ConversationApplicationError.notConnected());
  }
};

/**
 * Refuse posting to a thread whose other participant is blocked either way, with the generic
 * CannotReply (NotConnected never otherwise comes out of posting to an existing thread, so it
 * would single out a block). Unknown threads and non-participants pass through untouched, so
 * the caller's own ThreadNotFound / NotParticipant errors stay what they were. Exchange and DM
 * threads only: a circle thread is shared context, and a block between two of its members
 * removes neither from it (spec 5.3); the blocker sees the blocked member's messages collapsed.
 */
export const assertThreadNotBlocked = async (
  ctx: QueryCtx,
  threadAggregateId: string,
  memberId: Member,
): Promise<void> => {
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadAggregateId))
    .unique();
  if (!thread || !thread.participants.includes(asUserId(memberId))) return;
  if (thread.subjectKind === "circle") return;
  for (const other of thread.participants) {
    if (
      other !== asUserId(memberId) &&
      (await isBlockedEitherWay(ctx, memberId, other))
    ) {
      throw cannotReplyError();
    }
  }
};

/**
 * {@link assertPairNotBlocked} for an exchange the member acts on, against the other party.
 * Unknown exchanges and non-parties pass through to the use case's own errors.
 */
export const assertExchangeNotBlocked = async (
  ctx: QueryCtx,
  exchangeAggregateId: string,
  memberId: Member,
): Promise<void> => {
  const exchange = await ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", exchangeAggregateId),
    )
    .unique();
  if (!exchange) return;
  const me = asUserId(memberId);
  if (exchange.initiatorId !== me && exchange.recipientId !== me) return;
  await assertPairNotBlocked(ctx, exchange.initiatorId, exchange.recipientId);
};
