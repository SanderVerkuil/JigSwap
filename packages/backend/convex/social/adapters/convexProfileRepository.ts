import type { MemberId, Profile, ProfileRepository } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { profileToDomain, profileToRow } from "./mappers";

// Driven adapter for the ProfileRepository port over `ctx.db`. The only place the `profiles`
// table is read/written for the domain path; the mapper is the ACL. Profiles are keyed by member.
export const convexProfileRepository = (
  ctx: MutationCtx,
): ProfileRepository => ({
  async findByMember(memberId: MemberId): Promise<Profile | null> {
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) =>
        q.eq("memberId", memberId as unknown as Id<"users">),
      )
      .unique();
    return row ? profileToDomain(row) : null;
  },

  async save(profile: Profile): Promise<void> {
    const row = profileToRow(profile);
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", row.memberId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("profiles", row);
  },
});
