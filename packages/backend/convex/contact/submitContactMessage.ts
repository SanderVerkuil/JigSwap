import { normalizeInviteEmail } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { chargeBudget, CONTACT_BUDGET } from "../lib/rateLimits";

// Hard caps mirror the client-side form limits; the mutation is public
// (no requireMember) since the contact form lives on the marketing site, so a
// deployment-wide budget (CONTACT_BUDGET) bounds how many messages land.
const MAX_NAME = 200;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;

// Contact write (thin adapter): persists a marketing contact-form message for
// admin triage. Validation is duplicated client-side for UX; this is the
// authoritative check.
export const submitContactMessage = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.union(
      v.literal("swap"),
      v.literal("account"),
      v.literal("idea"),
      v.literal("other"),
    ),
    message: v.string(),
    locale: v.optional(v.union(v.literal("en"), v.literal("nl"))),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const email = args.email.trim();
    const message = args.message.trim();

    if (!name || name.length > MAX_NAME) {
      throw new ConvexError({ code: "invalid_name" });
    }
    // The address must be a valid HTML email address of at most 254 characters, the rule
    // email invitations use (domain normalizeInviteEmail), so no URL or header syntax reaches the
    // admin inbox through the domain part. Shape only: deliverability is the mailbox's problem.
    // Stored as typed (trimmed), not in the invite's lowercased form.
    if (!normalizeInviteEmail(email).isOk) {
      throw new ConvexError({ code: "invalid_email" });
    }
    if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) {
      throw new ConvexError({ code: "invalid_message" });
    }

    // Charged only for a valid message, so malformed requests never use it up. Refusals are not
    // logged one by one (anyone can loop this); the window filling is logged once.
    const retryAfterMs = await chargeBudget(ctx, CONTACT_BUDGET, 1, {
      logRefusals: false,
    });
    if (retryAfterMs !== null) {
      throw new ConvexError({ code: "RateLimited", retryAfterMs });
    }

    await ctx.db.insert("contactMessages", {
      name,
      email,
      subject: args.subject,
      message,
      locale: args.locale,
      status: "new",
      createdAt: Date.now(),
    });
  },
});
