import type { MemberId } from "@jigswap/domain";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireMember } from "./requireMember";

/** The member's user row exists and is active (not deactivated or tombstoned). */
export const isActiveMember = async (
  ctx: QueryCtx,
  memberId: MemberId | Id<"users">,
): Promise<boolean> =>
  (await ctx.db.get(memberId as unknown as Id<"users">))?.isActive === true;

// requireMember plus an isActive check, for surfaces that must stay closed to a deactivated or
// tombstoned account whose session is still valid (presence: a heartbeat after the account
// purge would recreate component rows with a lastDisconnected, spec 5.6). Refuses with the same
// generic error as a missing user row. requireMember itself now refuses inactive members too
// (#275), so this check is a redundant belt-and-braces for the presence surfaces.
export const requireActiveMember = async (ctx: QueryCtx): Promise<MemberId> => {
  const memberId = await requireMember(ctx);
  if (!(await isActiveMember(ctx, memberId)))
    throw new ConvexError("Member not found");
  return memberId;
};
