import type { MemberView } from "@jigswap/contracts";
import {
  toMemberId,
  tradePartyState,
  type TradePartyState,
  type TradeRevealReason,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";

// THE per-trade identity chokepoint. A trade reveal applies ONLY inside that one exchange (its
// views, notifications and — later — its conversation); it never unlocks the member's profile,
// collection or activity anywhere else, so every other surface keeps using projectMemberIdentity.
//   - The owner (recipient) always sees the requester (initiator) inside the trade: derived, no row.
//   - The requester sees the owner inside the trade once a `tradeReveals` row exists for it (the
//     owner accepted or replied — exchange/tradeRevealSubscriber).
// The decision itself is the pure domain rule (tradePartyState); this module loads the facts.
// Exported for the messaging stack to adopt for exchange threads (follow-up).

/** True iff the owner acted on this exchange (one indexed point read). */
export const hasTradeReveal = async (
  ctx: QueryCtx,
  exchangeId: Id<"exchanges">,
): Promise<boolean> =>
  (await ctx.db
    .query("tradeReveals")
    .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeId))
    .first()) !== null;

/** Idempotently record that the owner acted on this exchange; returns whether a row was written. */
export const recordTradeReveal = async (
  ctx: MutationCtx,
  exchangeId: Id<"exchanges">,
  reason: TradeRevealReason,
  revealedAt: number,
): Promise<boolean> => {
  if (await hasTradeReveal(ctx, exchangeId)) return false;
  await ctx.db.insert("tradeReveals", { exchangeId, reason, revealedAt });
  return true;
};

export type ProjectedTradeParty = {
  readonly state: TradePartyState;
  /** Present for self / visible / tradeRevealed; absent for hidden / departed. */
  readonly user?: Doc<"users">;
};

type PartyFacts = { user: Doc<"users"> | null; visible: boolean };

/**
 * Optional per-request memo of the viewer-independent-of-trade facts (the party's row and whether
 * they are visible to the viewer by the ordinary rules), keyed by party id. Pass one when projecting
 * many exchanges for the SAME viewer (e.g. the data export) so each counterparty is read once.
 */
export type TradePartyMemo = Map<Id<"users">, Promise<PartyFacts>>;

const loadPartyFacts = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  partyId: Id<"users">,
): Promise<PartyFacts> => {
  const user = await ctx.db.get(partyId);
  const visible =
    partyId !== viewerId &&
    user !== null &&
    user.isActive &&
    ((await profileVisibilityOf(ctx, partyId)) === "public" ||
      (await areMutualFollowers(ctx, viewerId, partyId)));
  return { user, visible };
};

/**
 * How `viewerId` sees `partyId` (one of the exchange's two parties) inside this exchange.
 * departed = users row missing or `isActive === false`; visible = public profile or mutual
 * followers; tradeRevealed = revealed by this trade only; hidden = otherwise.
 */
export const projectTradeParty = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  exchange: Doc<"exchanges">,
  partyId: Id<"users">,
  memo?: TradePartyMemo,
): Promise<ProjectedTradeParty> => {
  let facts = memo?.get(partyId);
  if (!facts) {
    facts = loadPartyFacts(ctx, viewerId, partyId);
    memo?.set(partyId, facts);
  }
  const { user, visible: partyVisible } = await facts;
  // Only the requester looking at the owner needs the per-trade row.
  const ownerActed =
    viewerId === exchange.initiatorId &&
    partyId === exchange.recipientId &&
    (await hasTradeReveal(ctx, exchange._id));
  const state = tradePartyState({
    viewer: toMemberId(viewerId),
    party: toMemberId(partyId),
    initiator: toMemberId(exchange.initiatorId),
    recipient: toMemberId(exchange.recipientId),
    ownerActed,
    partyActive: user !== null && user.isActive,
    partyVisible,
  });
  const revealed =
    state === "self" || state === "visible" || state === "tradeRevealed";
  return revealed && user ? { state, user } : { state };
};

/**
 * The LIMITED member view for a party revealed only by the trade: identity basics, no avatar, bio,
 * location or preferred language (those stay behind the member's own profile visibility).
 */
export const toTradeRevealedMemberView = (user: Doc<"users">): MemberView => ({
  _id: user._id,
  _creationTime: user._creationTime,
  name: user.name,
  username: user.username,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/** The member view a projected party is shown with: full, trimmed, or null. */
export const tradePartyMemberView = (
  party: ProjectedTradeParty,
): MemberView | null => {
  if (!party.user) return null;
  return party.state === "tradeRevealed"
    ? toTradeRevealedMemberView(party.user)
    : toMemberView(party.user);
};
