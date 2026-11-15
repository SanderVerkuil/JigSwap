import { paginationOptsValidator, type PaginationResult } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { paginateBounded } from "../lib/pageSize";

// Admin-only, but the page size is still the client's request (the console asks for 100). The table
// is fed by an anonymous form, up to DOC_FEEDBACK_BUDGET votes of 2,000 characters a day, so it can
// outgrow one read.
export const MAX_DOC_FEEDBACK_PAGE = 200;

// Admin triage read for the public /docs "Was this page helpful?" votes, newest first and paginated.
// Admin-only (requireAdmin), like the sibling contact-message triage read.
export const listDocFeedback = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<Doc<"docFeedback">>> => {
    await requireAdmin(ctx);
    return await paginateBounded(
      ctx.db.query("docFeedback").order("desc"),
      args.paginationOpts,
      MAX_DOC_FEEDBACK_PAGE,
    );
  },
});
