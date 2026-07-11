import { COOLDOWN_MS } from "@jigswap/domain";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";

// A logged-in member scanned someone's QR (or opened their invite link): one tap establishes the
// mutual follow. Own/invalid/revoked tokens are silently ignored — never an error, the landing
// page just shows nothing special.
export const acceptQrFollow = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      link.ownerId === memberId
    ) {
      return { established: false };
    }

    // Anti-pester invariant (Phase 2): while a decline of scanner→inviter is inside its
    // cooldown, NO path — button or QR — lets the declined requester force a connection.
    // Tokens are freely forwardable (share button, copyable URL), so possession is not
    // in-person consent. Silently no-op, exactly like a re-request through the button.
    // (A genuinely in-person pair has a remedy: the decliner follows the scanner directly,
    // and the follow-back exception makes the reverse instant.)
    const priorRequest = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", memberId).eq("targetId", link.ownerId),
      )
      .unique();
    if (
      priorRequest !== null &&
      priorRequest.status === "declined" &&
      priorRequest.respondedAt !== undefined &&
      Date.now() - priorRequest.respondedAt < COOLDOWN_MS
    ) {
      return { established: false };
    }

    await establishMutualFollow(ctx, link.ownerId, memberId);
    await ctx.db.patch(link._id, {
      followsEstablished: link.followsEstablished + 1,
    });
    return { established: true };
  },
});
