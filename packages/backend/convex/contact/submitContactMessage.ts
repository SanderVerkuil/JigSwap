import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

// Hard caps mirror the client-side form limits; the mutation is public
// (no requireMember) since the contact form lives on the marketing site.
const MAX_NAME = 200;
const MAX_EMAIL = 320;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;

// Pragmatic shape check only — deliverability is the mailbox's problem.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const email = args.email.trim();
    const message = args.message.trim();

    if (!name || name.length > MAX_NAME) {
      throw new ConvexError({ code: "invalid_name" });
    }
    if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
      throw new ConvexError({ code: "invalid_email" });
    }
    if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) {
      throw new ConvexError({ code: "invalid_message" });
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
