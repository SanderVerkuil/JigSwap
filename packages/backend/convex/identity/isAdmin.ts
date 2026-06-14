import type { QueryCtx } from "../_generated/server";

// Whether the acting caller is an admin. The role lives in the Clerk JWT (publicMetadata.role,
// surfaced as the `metadata.role` claim — the same source the web admin guard reads). Convex
// exposes JWT claims on the identity object; we read it defensively (nested `metadata.role` or a
// flat `role` claim) and fail CLOSED — an unauthenticated caller or a missing claim is NOT admin.
//
// NOTE: for this to be true on the server, the Clerk "convex" JWT template must include the
// metadata claim (e.g. `"metadata": "{{user.public_metadata}}"`). Without it, admins are simply
// treated as regular members (submissions stay pending) — safe, never an over-grant.
export const isAdmin = async (ctx: QueryCtx): Promise<boolean> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  const claims = identity as {
    metadata?: { role?: string };
    role?: string;
  };
  const role = claims.metadata?.role ?? claims.role;
  return role === "admin";
};
