import { toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "./blocks";
import { establishMutualFollow } from "./establishMutualFollow";
import { followMemberUseCase } from "./followMember";
import { isNetworkLink } from "./inviteLinkRules";
import { profileVisibilityOf } from "./privacy";

// established: a new follow edge now exists (the landing says "you now follow each other").
// requested: the scan sent the owner a follow request instead; nothing is followed yet.
type QrFollowResult = { established: boolean; requested?: true };

// A logged-in member scanned someone's QR (or opened their invite link). Own/invalid/revoked
// tokens are silently ignored — never an error, the landing page just shows nothing special.
// Household links are ignored: their only effect is redeemInvite.
// A token is forwardable, so holding one is not the owner's consent (SEC-42):
// - public owner: one tap establishes the mutual follow, as it always has;
// - private owner: the scan is exactly a follow request (what their Follow button would send), so
//   the owner decides. No edge is created and no pending request is approved. Only when the owner
//   already follows the scanner does the scan complete the mutual follow, like a follow-back.
export const acceptQrFollow = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<QrFollowResult> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      !isNetworkLink(link) ||
      link.ownerId === memberId
    ) {
      return { established: false };
    }

    if (await ownerMustApprove(ctx, link.ownerId, memberId)) {
      return requestToFollowOwner(ctx, link.ownerId, memberId);
    }

    // The decline-cooldown gate (anti-pester invariant) and the already-mutual short-circuit both
    // live in establishMutualFollow now, so this endpoint just acts on what it reports: bump the
    // counter and claim success ONLY when a genuinely new edge was created. A refused scan
    // (declined-in-cooldown) and an already-mutual repeat tap both yield edgesCreated:0 — no
    // counter inflation, and the landing card shows nothing rather than a lying success toast.
    const result = await establishMutualFollow(ctx, link.ownerId, memberId);
    if (result.edgesCreated > 0) {
      await ctx.db.patch(link._id, {
        followsEstablished: link.followsEstablished + 1,
      });
    }
    return { established: result.edgesCreated > 0 };
  },
});

// followMember's rule: following a private member needs their approval unless they already
// follow you.
async function ownerMustApprove(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  scannerId: Id<"users">,
): Promise<boolean> {
  if ((await profileVisibilityOf(ctx, ownerId)) !== "private") return false;
  const ownerFollowsScanner = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q.eq("followerId", ownerId).eq("followeeId", scannerId),
    )
    .first();
  return ownerFollowsScanner === null;
}

// Send the scanner's follow request through followMember's own use case, so a scan answers exactly
// what the Follow button would: a fresh request notifies the owner, a pending one stays pending,
// and an owner's decline inside its cooldown is swallowed and still reads as requested (a scan
// must not reveal a decline). The two cases that use case refuses with an error (a block either
// way, or the scanner already following) are answered quietly here instead, keeping this
// endpoint's never-an-error contract. followsEstablished counts follows, so it is not bumped.
async function requestToFollowOwner(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  scannerId: Id<"users">,
): Promise<QrFollowResult> {
  if (await isBlockedEitherWay(ctx, ownerId, scannerId)) {
    return { established: false };
  }
  const alreadyFollowing = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q.eq("followerId", scannerId).eq("followeeId", ownerId),
    )
    .first();
  if (alreadyFollowing !== null) return { established: false };

  const { kind } = await followMemberUseCase(ctx, toMemberId(scannerId), {
    followeeId: ownerId,
  });
  return kind === "requested"
    ? { established: false, requested: true }
    : { established: true };
}
