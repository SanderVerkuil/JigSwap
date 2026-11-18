import type { MemberId } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The member's user row exists and is active (not deactivated or tombstoned). */
export const isActiveMember = async (
  ctx: QueryCtx,
  memberId: MemberId | Id<"users">,
): Promise<boolean> =>
  (await ctx.db.get(memberId as unknown as Id<"users">))?.isActive === true;
