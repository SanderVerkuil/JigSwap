import type { AdminUserView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { clampPaginationOpts } from "../lib/pageSize";

// Admin-only, but the page size is still the client's request: one page joins each member's
// library size, so it holds at most this many members (the console asks for 25).
const MAX_PAGE_SIZE = 50;

// Admin read model: every member, paginated newest-first, with the display-only mirrored Clerk
// role and the member's library size joined in. Admin-only, gated exactly like
// getModerationActivity. An optional search term switches to the by_searchable_name search index
// (the same index identity/searchUsers uses — but with no profile-privacy gate: this surface is
// admin-only and includes email by design). A term shaped like an email address instead looks
// that address up exactly (users.by_email), so the sender of a contact message can be found; it
// never matches part of an address. READ-ONLY page in v1: no companion mutations.
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

// "local@domain" with no spaces: looked up as an exact address, not searched by name.
const EMAIL_SHAPED = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MATCH_LIMIT = 10;

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PaginationResult<AdminUserView>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const term = args.search?.trim() ?? "";
    if (EMAIL_SHAPED.test(term)) {
      // The address as typed and in lower case (a visitor may type it in other case than the
      // member's verified one). One page: an address belongs to at most a handful of members.
      const matches = new Map<Id<"users">, Doc<"users">>();
      for (const email of new Set([term, term.toLowerCase()])) {
        const users = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
          .take(EMAIL_MATCH_LIMIT);
        for (const user of users) matches.set(user._id, user);
      }
      return {
        page: await Promise.all(
          [...matches.values()].map((u) => toAdminUserView(ctx, u)),
        ),
        isDone: true,
        continueCursor: "",
      };
    }

    const search = term.toLowerCase();
    const paginationOpts = clampPaginationOpts(
      args.paginationOpts,
      MAX_PAGE_SIZE,
    );
    const result =
      search.length > 0
        ? await ctx.db
            .query("users")
            .withSearchIndex("by_searchable_name", (q) =>
              q.search("searchableName", search),
            )
            .paginate(paginationOpts)
        : await ctx.db.query("users").order("desc").paginate(paginationOpts);

    return {
      ...result,
      page: await Promise.all(result.page.map((u) => toAdminUserView(ctx, u))),
    };
  },
});
