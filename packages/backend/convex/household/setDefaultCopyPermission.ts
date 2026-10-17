import {
  makeSetHouseholdDefaultCopyPermission,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { householdDeps } from "./adapters/deps";
import { toConvexError } from "./errors";

// Composition root: the household ADMIN sets the household-wide default permission for member
// copies without an explicit value (admin-only is enforced by the aggregate; no household →
// NotInHousehold). It applies at read time to every such copy immediately; no notifications.
export const setDefaultCopyPermission = mutation({
  args: { permission: v.union(v.literal("manage"), v.literal("view")) },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const actorId = await requireMember(ctx);
    const result = await makeSetHouseholdDefaultCopyPermission(
      householdDeps(ctx),
    )({ actorId: toMemberId(actorId), permission: args.permission });
    if (result.isErr) throw toConvexError(result.error);
    return { changed: result.value.changed };
  },
});
