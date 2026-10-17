import { makeInviteToHousehold, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { mutation, MutationCtx } from "../_generated/server";
import { householdDeps } from "../household/adapters/deps";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";
import { isLiveLink, isNetworkLink } from "./inviteLinkRules";

// Redemption is a one-time POST-SIGNUP action, so only a freshly created account may redeem. Mirrors
// the client's NEW_MEMBER_WINDOW_MS (invite-redeemer.tsx); a genuine post-signup redeem lands well
// inside 15 min. Enforced server-side because Convex mutations are public endpoints.
const NEW_MEMBER_WINDOW_MS = 15 * 60 * 1000;

type RedeemResult = {
  redeemed: boolean;
  inviterId?: Id<"users">;
  // Household links only: "pending" when a household invite now waits for the new member to
  // accept, "skipped" when the household side was refused (the follow and attribution stand).
  householdInvite?: "pending" | "skipped";
};

// Post-signup invite redemption: called once by the client (InviteRedeemer) when a localStorage
// token survives the Clerk redirect. Idempotent per member via inviteRedemptions.by_new_member —
// a member can only ever be attributed to one inviter. Revoked/self/unknown tokens no-op, and so
// do expired or already-used household links (invalid as a whole: no ledger, no follow).
export const redeemInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<RedeemResult> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    // Newness guard: an EXISTING member could log out, open an invite link, and log back in —
    // without this they'd be recorded as signupsAttributed +1 and permanently attributed. A real
    // signup redeems within the window; anything older is not a new-member redemption. No ledger
    // row, no counters, no follow — and, for a household link, no invite and no consumption.
    const me = await ctx.db.get(memberId);
    if (me === null || Date.now() - me.createdAt >= NEW_MEMBER_WINDOW_MS) {
      return { redeemed: false };
    }

    const prior = await ctx.db
      .query("inviteRedemptions")
      .withIndex("by_new_member", (q) => q.eq("newMemberId", memberId))
      .unique();
    if (prior !== null) return { redeemed: false };

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      !isLiveLink(link, Date.now()) ||
      link.ownerId === memberId
    ) {
      return { redeemed: false };
    }

    await ctx.db.insert("inviteRedemptions", {
      inviteLinkId: link._id,
      inviterId: link.ownerId,
      newMemberId: memberId,
      createdAt: Date.now(),
    });
    const result = await establishMutualFollow(ctx, link.ownerId, memberId);
    // A brand-new member (the only real redeemInvite case) has no prior request rows, so the
    // decline-cooldown gate can never refuse them — a refusal here is purely defensive against a
    // forwarded token wielded by an existing member. Keep the redemption ledger row + the signup
    // attribution regardless (a signup genuinely happened, and the ledger keeps it idempotent),
    // but only count a follow when an edge was actually created.
    await ctx.db.patch(link._id, {
      signupsAttributed: link.signupsAttributed + 1,
      followsEstablished:
        link.followsEstablished + (result.edgesCreated > 0 ? 1 : 0),
    });
    if (isNetworkLink(link)) {
      return { redeemed: true, inviterId: link.ownerId };
    }

    await ctx.db.patch(link._id, {
      consumedAt: Date.now(),
      consumedBy: memberId,
    });
    return {
      redeemed: true,
      inviterId: link.ownerId,
      householdInvite: await inviteIntoLinkHousehold(ctx, link, memberId),
    };
  },
});

// The household side of a household link: a PENDING invite from the link's owner, through the
// same use case as an in-app invite, so it re-checks (at redeem time) that the owner is still the
// admin, that the new member is in no household and that no invite is pending, and it emits
// HouseholdInviteSent for the existing notification. The invitee must accept: never auto-join.
// The owner must still be in the household the link was minted for, so a link outlives neither
// their admin role nor that household. Any refusal is reported as "skipped".
async function inviteIntoLinkHousehold(
  ctx: MutationCtx,
  link: Doc<"inviteLinks">,
  inviteeId: Id<"users">,
): Promise<"pending" | "skipped"> {
  const deps = householdDeps(ctx);
  const actorId = toMemberId(link.ownerId);
  const current = await deps.households.findByMember(actorId);
  if (!current || (current.id as string) !== link.context?.householdId) {
    return "skipped";
  }
  const invite = await makeInviteToHousehold(deps)({
    actorId,
    inviteeId: toMemberId(inviteeId),
  });
  return invite.isErr ? "skipped" : "pending";
}
