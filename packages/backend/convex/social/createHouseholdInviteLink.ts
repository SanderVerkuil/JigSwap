import { HouseholdApplicationError, HouseholdError } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { convexHouseholdRepository } from "../household/adapters/convexHouseholdRepository";
import { toConvexError } from "../household/errors";
import { requireMember } from "../identity/requireMember";
import {
  HOUSEHOLD_LINK_TTL_MS,
  HOUSEHOLD_LINK_WINDOW_MS,
  isLiveLink,
  MAX_HOUSEHOLD_LINKS_PER_DAY,
  MAX_OPEN_HOUSEHOLD_LINKS,
  recentHouseholdLinks,
} from "./inviteLinkRules";

// The household admin mints a fresh single-use invite link for their household (spec §3.4). It
// takes no recipient: the link is shared from the device, and JigSwap never learns who gets it.
// Redeeming it as a new member creates a PENDING household invite (redeemInvite); never a join.
export const createHouseholdInviteLink = mutation({
  args: {},
  handler: async (ctx): Promise<{ token: string; expiresAt: number }> => {
    const actorId = await requireMember(ctx);
    const ownerId = actorId as unknown as Id<"users">;

    // The same admin rule makeInviteToHousehold enforces, checked up front so a non-admin never
    // holds a household token at all (redeem re-checks it).
    const household =
      await convexHouseholdRepository(ctx).findByMember(actorId);
    if (!household) {
      throw toConvexError(HouseholdApplicationError.notInHousehold());
    }
    if (!household.isAdmin(actorId)) {
      throw toConvexError(HouseholdError.notHouseholdAdmin());
    }

    const now = Date.now();
    const recent = await recentHouseholdLinks(ctx, ownerId, now);
    const open = recent.filter((row) => isLiveLink(row, now)).length;
    const createdToday = recent.filter(
      (row) => row.createdAt > now - HOUSEHOLD_LINK_WINDOW_MS,
    ).length;
    if (
      open >= MAX_OPEN_HOUSEHOLD_LINKS ||
      createdToday >= MAX_HOUSEHOLD_LINKS_PER_DAY
    ) {
      throw new ConvexError({
        code: "invite_rate_limited",
        message: "Too many household invite links",
      });
    }

    const token = crypto.randomUUID().replaceAll("-", "");
    const expiresAt = now + HOUSEHOLD_LINK_TTL_MS;
    await ctx.db.insert("inviteLinks", {
      ownerId,
      token,
      createdAt: now,
      landingViews: 0,
      signupsAttributed: 0,
      followsEstablished: 0,
      context: { kind: "household", householdId: household.id as string },
      expiresAt,
    });
    return { token, expiresAt };
  },
});
