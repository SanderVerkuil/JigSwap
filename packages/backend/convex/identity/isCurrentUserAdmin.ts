import { query } from "../_generated/server";
import { isAdmin } from "./isAdmin";

// Whether the acting caller is an admin, exposed as a public query so the web
// tier's /admin route guard can ask the backend (the single authz source of
// truth) instead of re-deriving the role from Clerk session claims. Reuses the
// isAdmin helper, so it fails CLOSED: unauthenticated or missing claim => false.
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => isAdmin(ctx),
});
