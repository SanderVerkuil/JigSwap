import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Reads were cut over to thin driving adapters under convex/exchange/* (returning typed view DTOs
// from @jigswap/contracts). Only the write mutation remains on this legacy module.

// Send message in trade request
export const sendExchangeMessage = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    senderId: v.id("users"),
    content: v.string(),
    messageType: v.optional(
      v.union(v.literal("text"), v.literal("image"), v.literal("system")),
    ),
  },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    // Determine receiver
    const receiverId =
      args.senderId === exchange.initiatorId
        ? exchange.recipientId
        : exchange.initiatorId;

    const messageId = await ctx.db.insert("messages", {
      exchangeId: args.exchangeId,
      senderId: args.senderId,
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
