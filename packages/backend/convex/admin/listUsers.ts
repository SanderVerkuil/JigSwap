import type { AdminUserView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin read model: every member, paginated newest-first, with the display-only mirrored Clerk
// role and the member's library size joined in. Admin-only, gated exactly like
// getModerationActivity. An optional search term switches to the by_searchable_name search index
// (the same index identity/searchUsers uses — but with no profile-privacy gate: this surface is
// admin-only and includes email by design). READ-ONLY page in v1: no companion mutations.
const toAdminUserView = async (
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<AdminUserView> => ({
  _id: user._id,
  _creationTime: user._creationTime,
  name: user.name,
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  isActive: user.isActive,
  role: user.role,
  ownedCopyCount: (
    await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect()
  ).length,
  createdAt: user.createdAt,
});

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaginationResult<AdminUserView>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const search = args.search?.trim().toLowerCase() ?? "";
    const result =
      search.length > 0
        ? await ctx.db
            .query("users")
            .withSearchIndex("by_searchable_name", (q) =>
              q.search("searchableName", search),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("users")
            .order("desc")
            .paginate(args.paginationOpts);

    return {
      ...result,
      page: await Promise.all(result.page.map((u) => toAdminUserView(ctx, u))),
    };
  },
});
