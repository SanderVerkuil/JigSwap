import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

// Type definitions for trade requests
interface ExchangeWithUserRole extends Doc<"exchanges"> {
  userRole: "requester" | "owner";
}

// Get trade request by ID
export const getExchangeById = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) return null;

    // Get related data
    const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
      ctx.db.get(exchange.initiatorId),
      ctx.db.get(exchange.recipientId),
      ctx.db.get(exchange.requestedPuzzleId),
      exchange.offeredPuzzleId ? ctx.db.get(exchange.offeredPuzzleId) : null,
    ]);

    return {
      ...exchange,
      requester,
      owner,
      ownerPuzzle,
      requesterPuzzle,
    };
  },
});

// Get trade requests for a user (as requester or owner)
export const getUserExchanges = query({
  args: {
    userId: v.id("users"),
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    asRequester: v.optional(v.boolean()),
    asOwner: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let exchanges: ExchangeWithUserRole[] = [];

    // Get requests where user is the requester
    if (args.asRequester !== false) {
      const requesterExchanges = await ctx.db
        .query("exchanges")
        .withIndex("by_initiator", (q) => q.eq("initiatorId", args.userId))
        .collect();
      exchanges.push(
        ...requesterExchanges.map((tr) => ({
          ...tr,
          userRole: "requester" as const,
        })),
      );
    }

    // Get requests where user is the owner
    if (args.asOwner !== false) {
      const ownerExchanges = await ctx.db
        .query("exchanges")
        .withIndex("by_recipient", (q) => q.eq("recipientId", args.userId))
        .collect();
      exchanges.push(
        ...ownerExchanges.map((tr) => ({ ...tr, userRole: "owner" as const })),
      );
    }

    // Filter by status if provided
    if (args.status) {
      exchanges = exchanges.filter((tr) => tr.status === args.status);
    }

    // Sort by creation date (newest first)
    exchanges.sort((a, b) => b.createdAt - a.createdAt);

    // Get related data for each trade request
    const enrichedExchanges = await Promise.all(
      exchanges.map(async (tr) => {
        const [requester, owner, requestedOwnedPuzzle, offeredOwnedPuzzle] =
          await Promise.all([
            ctx.db.get(tr.initiatorId),
            ctx.db.get(tr.recipientId),
            ctx.db.get(tr.requestedPuzzleId),
            tr.offeredPuzzleId ? ctx.db.get(tr.offeredPuzzleId) : null,
          ]);

        const [requestedPuzzle, offeredPuzzle] = await Promise.all([
          requestedOwnedPuzzle
            ? ctx.db.get(requestedOwnedPuzzle.puzzleId)
            : null,
          offeredOwnedPuzzle ? ctx.db.get(offeredOwnedPuzzle.puzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          requestedPuzzle,
          requestedOwnedPuzzle,
          offeredPuzzle,
          offeredOwnedPuzzle,
        };
      }),
    );

    return enrichedExchanges;
  },
});

// Get trade statistics
export const getExchangeStats = query({
  args: {},
  handler: async (ctx) => {
    const allExchanges = await ctx.db.query("exchanges").collect();

    const stats = {
      total: allExchanges.length,
      proposed: allExchanges.filter((t) => t.status === "proposed").length,
      accepted: allExchanges.filter((t) => t.status === "accepted").length,
      completed: allExchanges.filter((t) => t.status === "completed").length,
      rejected: allExchanges.filter((t) => t.status === "rejected").length,
      cancelled: allExchanges.filter((t) => t.status === "cancelled").length,
    };

    return stats;
  },
});

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

// Get messages for a trade request
export const getExchangeMessages = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_exchange", (q) => q.eq("exchangeId", args.exchangeId))
      .collect();

    // Get sender information for each message
    const messagesWithSenders = await Promise.all(
      messages.map(async (message) => {
        const sender = await ctx.db.get(message.senderId);
        return {
          ...message,
          sender: sender
            ? {
                _id: sender._id,
                name: sender.name,
                avatar: sender.avatar,
              }
            : null,
        };
      }),
    );

    return messagesWithSenders.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Get trade requests by owner
export const getExchangesByOwner = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      return [];
    }

    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
      .collect();

    // Get related data for each trade request
    const enrichedExchanges = await Promise.all(
      exchanges.map(async (tr) => {
        const [requester, owner, requestedOwnedPuzzle, offeredOwnedPuzzle] =
          await Promise.all([
            ctx.db.get(tr.initiatorId),
            ctx.db.get(tr.recipientId),
            ctx.db.get(tr.requestedPuzzleId),
            tr.offeredPuzzleId ? ctx.db.get(tr.offeredPuzzleId) : null,
          ]);

        const [requestedPuzzle, offeredPuzzle] = await Promise.all([
          requestedOwnedPuzzle
            ? ctx.db.get(requestedOwnedPuzzle.puzzleId)
            : null,
          offeredOwnedPuzzle ? ctx.db.get(offeredOwnedPuzzle.puzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          requestedOwnedPuzzle,
          requestedPuzzle,
          offeredOwnedPuzzle,
          offeredPuzzle,
        };
      }),
    );

    return enrichedExchanges.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get trade requests by requester
export const getExchangesByRequester = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      return [];
    }

    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", user._id))
      .collect();

    // Get related data for each trade request
    const enrichedExchanges = await Promise.all(
      exchanges.map(async (tr) => {
        const [requester, owner, requestedOwnedPuzzle, offeredOwnedPuzzle] =
          await Promise.all([
            ctx.db.get(tr.initiatorId),
            ctx.db.get(tr.recipientId),
            ctx.db.get(tr.requestedPuzzleId),
            tr.offeredPuzzleId ? ctx.db.get(tr.offeredPuzzleId) : null,
          ]);

        const [requestedPuzzle, offeredPuzzle] = await Promise.all([
          requestedOwnedPuzzle
            ? ctx.db.get(requestedOwnedPuzzle.puzzleId)
            : null,
          offeredOwnedPuzzle ? ctx.db.get(offeredOwnedPuzzle.puzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          requestedPuzzle,
          requestedOwnedPuzzle,
          offeredPuzzle,
          offeredOwnedPuzzle,
        };
      }),
    );

    return enrichedExchanges.sort((a, b) => b.createdAt - a.createdAt);
  },
});
