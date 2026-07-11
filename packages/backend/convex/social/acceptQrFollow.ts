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
