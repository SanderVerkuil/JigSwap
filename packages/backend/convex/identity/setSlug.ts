import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "./requireMember";

// Route words that would collide with an existing or foreseeable top-level path if a member's
// slug were used to build a direct profile link (Instagram-style: /<slug>). Kept deliberately
// small and reviewed by hand — this is NOT meant to track every app route automatically.
const RESERVED_SLUGS = new Set([
  "add",
  "me",
  "settings",
  "profile",
  "admin",
  "api",
  "new",
  "edit",
  "members",
  "catalog",
  "people",
  "help",
  "support",
  "login",
  "logout",
  "signin",
  "signup",
  "public",
  "static",
]);

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Format-only validation: lowercase alnum + single hyphens, 3-30 chars. The regex alone would
// accept "a--b" (consecutive hyphens are valid *characters* in the middle class), so double
// hyphens are rejected separately.
const isValidSlugFormat = (slug: string): boolean =>
  slug.length >= 3 &&
  slug.length <= 30 &&
  SLUG_PATTERN.test(slug) &&
  !slug.includes("--");

// Set (or clear) the acting member's Convex-owned profile handle. Unlike `username` (Clerk-owned,
// synced by the webhook), the slug is validated and enforced unique entirely in this mutation —
// Convex has no unique-constraint mechanism, so uniqueness is a read-then-check against `by_slug`
// inside this single transaction. `slug: null` (or an empty/whitespace string) clears it.
export const setSlug = mutation({
  args: { slug: v.union(v.string(), v.null()) },
  handler: async (ctx, { slug }) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const trimmed = slug?.trim() ?? "";
    if (!trimmed) {
      await ctx.db.patch(userId, { slug: undefined, updatedAt: Date.now() });
      return;
    }

    // Defensive: a slug shaped like a Convex id could otherwise be confused with an id-based
    // lookup (getPublicMemberTeaser resolves id-first). Checked before the format rules below so
    // it rejects regardless of an id's length/character shape.
    if (ctx.db.normalizeId("users", trimmed)) {
      throw new ConvexError("That slug isn't allowed.");
    }
    if (!isValidSlugFormat(trimmed)) {
      throw new ConvexError(
        "Slugs must be 3-30 lowercase letters, numbers, or single hyphens (no leading, trailing, or double hyphens).",
      );
    }
    if (RESERVED_SLUGS.has(trimmed)) {
      throw new ConvexError(
        `"${trimmed}" is a reserved word and can't be used as a slug.`,
      );
    }

    const holder = await ctx.db
      .query("users")
      .withIndex("by_slug", (q) => q.eq("slug", trimmed))
      .unique();
    if (holder && holder._id !== userId) {
      throw new ConvexError(`"${trimmed}" is already taken.`);
    }

    await ctx.db.patch(userId, { slug: trimmed, updatedAt: Date.now() });
  },
});
