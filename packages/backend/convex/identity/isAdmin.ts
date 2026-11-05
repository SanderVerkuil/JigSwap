import type { QueryCtx } from "../_generated/server";

// Whether the acting caller is an admin. The role lives in Clerk publicMetadata.role, surfaced as
// the `metadata.role` claim by the Clerk "convex" JWT template. The web /admin guard asks this same
// check (identity/isCurrentUserAdmin). Only that nested claim counts: a flat `role` claim is
// ignored, so nothing but the template's `metadata` mapping can grant admin. Fails CLOSED: an
// unauthenticated caller or a missing claim is NOT admin.
//
// The expected template is versioned in packages/backend/clerk/convex-jwt-template.json (checked by
// clerkTemplates.test.ts). It must map `metadata` to {{user.public_metadata}}, never to
// unsafe_metadata, which the browser can write.
export const isAdmin = async (ctx: QueryCtx): Promise<boolean> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  const claims = identity as { metadata?: { role?: string } };
  return claims.metadata?.role === "admin";
};
