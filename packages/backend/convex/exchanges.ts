import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireMember } from "./identity/requireMember";

// Reads were cut over to thin driving adapters under convex/exchange/* (returning typed view DTOs
// from @jigswap/contracts). Only the write mutation remains on this legacy module.

// Send message in trade request
export const sendExchangeMessage = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    content: v.string(),
    // Client may only post 'text'/'image'. 'system' is reserved for server-side
    // service code (status announcements rendered with authoritative styling); a
    // party must not be able to spoof a system message inside an exchange thread.
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"))),
  },
  handler: async (ctx, args) => {
    // Sender is the authenticated member, never a client-supplied id (spoofing).
    const senderId = (await requireMember(ctx)) as unknown as Id<"users">;

    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    // Only a party to the exchange may post into its thread.
    if (
      senderId !== exchange.initiatorId &&
      senderId !== exchange.recipientId
    ) {
      throw new ConvexError("Forbidden");
    }

    // Determine receiver from the exchange, not the client.
    const receiverId =
      senderId === exchange.initiatorId
        ? exchange.recipientId
        : exchange.initiatorId;

    const messageId = await ctx.db.insert("messages", {
      exchangeId: args.exchangeId,
      senderId,
      receiverId,
      content: args.content,
      messageType: args.messageType ?? "text",
      isRead: false,
      createdAt: Date.now(),
    });

    // Create notification for receiver
    await ctx.db.insert("notifications", {
      userId: receiverId,
      type: "message_received",
      title: "New Message",
      message: "You have a new message in your trade conversation",
      relatedId: args.exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });

    return messageId;
  },
});
