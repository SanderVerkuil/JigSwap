import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { paginateBounded } from "../lib/pageSize";

// Admin-only, but the page size is still the client's request (the console asks for 100). The table
// is fed by an anonymous form, up to DOC_FEEDBACK_BUDGET votes of 2,000 characters a day, so it can
// outgrow one read.
export const MAX_DOC_FEEDBACK_PAGE = 200;

// Admin triage read for the public /docs "Was this page helpful?" votes, newest first and paginated.
// Admin-only (requireMember + isAdmin), like the sibling contact-message triage read.
export const listDocFeedback = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<Doc<"docFeedback">>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await paginateBounded(
      ctx.db.query("docFeedback").order("desc"),
      args.paginationOpts,
      MAX_DOC_FEEDBACK_PAGE,
    );
  },
});
