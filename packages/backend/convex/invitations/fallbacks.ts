import { makeInviteToHousehold, toMemberId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { householdDeps } from "../household/adapters/deps";
import { isBlockedEitherWay } from "../social/blocks";
import { offerConnection } from "../social/connectionOffers";

// The in-app side of an email invitation (spec E1/E2): a connection offer (follow) or a pending
// household invite (household), made when the address already belonged to a member, and the
// household invite made at sign-up through the link (applySignupInvite).

export type EmailInviteFallback = NonNullable<Doc<"emailInvites">["fallback"]>;

const pendingOfferBetween = (
  ctx: MutationCtx,
  fromId: Id<"users">,
  toId: Id<"users">,
) =>
  ctx.db
    .query("connectionOffers")
    .withIndex("by_from_to_status", (q) =>
      q.eq("fromId", fromId).eq("toId", toId).eq("status", "pending"),
    )
    .first();

/**
 * A pending household invite from the inviter into `householdId`, through the same use case as an
 * in-app invite (admin only, invitee in no household, one pending invite). Only while the inviter
 * is still in that household, and never for a pair blocked either way. The new invite's id, or
 * undefined when none was made.
 */
export const inviteIntoEmailInviteHousehold = async (
  ctx: MutationCtx,
  args: {
    inviterId: Id<"users">;
    householdId: string | undefined;
    inviteeId: Id<"users">;
  },
): Promise<string | undefined> => {
  if (args.householdId === undefined) return undefined;
  if (await isBlockedEitherWay(ctx, args.inviterId, args.inviteeId)) {
    return undefined;
  }
  const deps = householdDeps(ctx);
  const actorId = toMemberId(args.inviterId);
  const current = await deps.households.findByMember(actorId);
  if (!current || (current.id as string) !== args.householdId) {
    return undefined;
  }
  const invite = await makeInviteToHousehold(deps)({
    actorId,
    inviteeId: toMemberId(args.inviteeId),
  });
  return invite.isErr ? undefined : (invite.value as string);
};

/**
 * The existing-member path of sendEmailInvite: the kind's normal in-app invite instead of an
 * email, gated as usual (offerConnection's blocks, decline cooldown and mutual-follow rules; the
 * household rules above). Returns what it made, for a revoke to withdraw, or undefined. The
 * inviter is never told either way.
 */
export const applyExistingMemberFallback = async (
  ctx: MutationCtx,
  args: {
    kind: Doc<"emailInvites">["kind"];
    inviterId: Id<"users">;
    householdId?: string;
    memberId: Id<"users">;
    ref: string;
  },
): Promise<EmailInviteFallback | undefined> => {
  if (args.memberId === args.inviterId) return undefined;

  if (args.kind === "follow") {
    // offerConnection reuses an open offer for the pair (one made through a profile invite link,
    // say). Only an offer made HERE belongs to this invitation, so only that one is recorded.
    const before = await pendingOfferBetween(
      ctx,
      args.inviterId,
      args.memberId,
    );
    const outcome = await offerConnection(ctx, {
      fromId: args.inviterId,
      toId: args.memberId,
      source: "emailInvite",
    });
    if (outcome !== "pending") return undefined;
    const after = await pendingOfferBetween(ctx, args.inviterId, args.memberId);
    if (after === null || after._id === before?._id) return undefined;
    return { connectionOfferId: after.aggregateId };
  }

  const inviteId = await inviteIntoEmailInviteHousehold(ctx, {
    inviterId: args.inviterId,
    householdId: args.householdId,
    inviteeId: args.memberId,
  });
  if (inviteId === undefined) return undefined;
  // viaEmail keeps it out of the admin's named pending list (getMyHousehold): showing who it went
  // to would reveal that the address has an account.
  const row = await ctx.db
    .query("householdInvites")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
    .unique();
  if (row !== null) await ctx.db.patch(row._id, { viaEmail: true });
  return { householdInviteId: inviteId };
};

/** Delete the recipient's notifications of `type` about one offer or invite. */
export const deleteNotificationsAbout = async (
  ctx: MutationCtx,
  recipientId: Id<"users">,
  type: "connection_offer_received" | "household_invite_received",
  subjectId: string,
): Promise<void> => {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_user_type", (q) =>
      q.eq("userId", recipientId).eq("type", type),
    )
    .collect();
  for (const row of rows) {
    const subject = row.subject;
    const id =
      subject?.kind === "connectionOffer"
        ? subject.offerId
        : subject?.kind === "householdInvite"
          ? subject.inviteId
          : undefined;
    if (id === subjectId) await ctx.db.delete(row._id);
  }
};

/**
 * Withdraw the row's in-app fallback while it is still pending (revoke, account deletion): the
 * offer or invite goes, with the notification about it. Only what the invitation itself made: an
 * offer of another source, or a household invite the admin made in-app instead (which replaced
 * the viaEmail one), is left alone. An answered one is the member's own decision and stays.
 */
export const withdrawFallback = async (
  ctx: MutationCtx,
  row: Doc<"emailInvites">,
): Promise<void> => {
  const offerId = row.fallback?.connectionOfferId;
  if (offerId !== undefined) {
    const offer = await ctx.db
      .query("connectionOffers")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", offerId))
      .unique();
    if (
      offer !== null &&
      offer.status === "pending" &&
      offer.source === "emailInvite" &&
      offer.fromId === row.inviterId
    ) {
      await deleteNotificationsAbout(
        ctx,
        offer.toId,
        "connection_offer_received",
        offer.aggregateId,
      );
      await ctx.db.delete(offer._id);
    }
  }

  const inviteId = row.fallback?.householdInviteId;
  if (inviteId !== undefined) {
    const invite = await ctx.db
      .query("householdInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
      .unique();
    if (
      invite !== null &&
      invite.status === "pending" &&
      invite.viaEmail === true &&
      invite.inviterId === row.inviterId
    ) {
      await deleteNotificationsAbout(
        ctx,
        invite.inviteeId,
        "household_invite_received",
        invite.aggregateId,
      );
      await ctx.db.delete(invite._id);
    }
  }
};
