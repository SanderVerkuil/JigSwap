import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

// Type definitions for trade requests
interface ExchangeWithUserRole extends Doc<"exchanges"> {
  userRole: "requester" | "owner";
}

// Type for notification types
type NotificationType =
  | "trade_request"
  | "trade_accepted"
  | "trade_declined"
  | "trade_completed"
  | "trade_cancelled"
  | "message_received";

// Create a trade request
export const createExchange = mutation({
  args: {
    initiatorId: v.id("users"),
    recipientId: v.id("users"),
    offeredPuzzleId: v.optional(v.id("ownedPuzzles")),
    requestedPuzzleId: v.id("ownedPuzzles"),
    type: v.union(v.literal("trade"), v.literal("sale"), v.literal("loan")),
    message: v.optional(v.string()),
    proposedExchangeDate: v.optional(v.number()),
    shippingMethod: v.optional(
      v.union(v.literal("pickup"), v.literal("mail"), v.literal("meetup")),
    ),
  },
  handler: async (ctx, args) => {
    // Validate that the requester is not the owner
    if (args.initiatorId === args.recipientId) {
      throw new Error("Cannot create trade request with yourself");
    }

    // Validate that the owner puzzle exists and is available
    const requestedPuzzle = await ctx.db.get(args.requestedPuzzleId);
    if (!requestedPuzzle) {
      throw new Error("Requested puzzle could not be found");
    }

    switch (args.type) {
      case "trade":
        if (!args.offeredPuzzleId) {
          throw new Error("Offered puzzle is required for trade");
        }
        const offeredPuzzle = await ctx.db.get(args.offeredPuzzleId);
        if (!offeredPuzzle) {
          throw new Error("Offered puzzle could not be found");
        }
        if (offeredPuzzle.ownerId !== args.initiatorId) {
          throw new Error("You can only offer your own puzzles");
        }
        if (requestedPuzzle.availability.forTrade) {
          throw new Error("Requested puzzle is not available for trade");
        }
        break;
      case "sale":
        if (requestedPuzzle.availability.forSale) {
          throw new Error("Requested puzzle is not available for sale");
        }
        if (args.offeredPuzzleId !== undefined) {
          throw new Error("Did you actually mean to trade?");
        }
        break;
      case "loan":
        if (requestedPuzzle.availability.forLend) {
          throw new Error("Requested puzzle is not available for loan");
        }
        if (args.offeredPuzzleId !== undefined) {
          throw new Error("Did you actually mean to trade?");
        }
        break;
    }

    // Check if there's already a proposed trade request for this combination
    const existingRequest = await ctx.db
      .query("exchanges")
      .filter((q) =>
        q.and(
          q.eq(q.field("initiatorId"), args.initiatorId),
          q.eq(q.field("requestedPuzzleId"), args.requestedPuzzleId),
          q.eq(q.field("status"), "proposed"),
        ),
      )
      .first();

    if (existingRequest) {
      throw new Error(
        "You already have a proposed trade request for this puzzle",
      );
    }

    const now = Date.now();
    const exchangeId = await ctx.db.insert("exchanges", {
      ...args,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });

    // Create notification for the owner
    await ctx.db.insert("notifications", {
      userId: args.recipientId,
      type: "trade_request",
      title: "New Exchange Request",
      message: "Someone wants to trade for one of your puzzles",
      relatedId: exchangeId,
      isRead: false,
      createdAt: now,
    });

    return exchangeId;
  },
});

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

// Update trade request status
export const updateExchangeStatus = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    status: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    responseMessage: v.optional(v.string()),
    actualExchangeDate: v.optional(v.number()),
    trackingInfo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { exchangeId, status, ...updates } = args;

    const exchange = await ctx.db.get(exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    await ctx.db.patch(exchangeId, {
      status,
      ...updates,
      updatedAt: Date.now(),
    });

    // Create notification for the other party
    const notificationUserId =
      status === "accepted" || status === "rejected"
        ? exchange.initiatorId
        : exchange.recipientId;

    const notificationMessages = {
      accepted: "Your trade request has been accepted!",
      rejected: "Your trade request has been declined",
      completed: "Exchange has been marked as completed",
      cancelled: "Exchange request has been cancelled",
    };

    await ctx.db.insert("notifications", {
      userId: notificationUserId,
      type: `trade_${status}` as NotificationType,
      title: `Exchange ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessages[status],
      relatedId: exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });

    // If trade is completed, mark puzzles as unavailable
    if (status === "completed") {
      await ctx.db.patch(exchange.requestedPuzzleId, {
        availability: {
          forTrade: false,
          forSale: false,
          forLend: false,
        },
      });
      if (exchange.offeredPuzzleId) {
        await ctx.db.patch(exchange.offeredPuzzleId, {
          availability: {
            forTrade: false,
            forSale: false,
            forLend: false,
          },
        });
      }
    }
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

// Accept trade request
export const acceptExchange = mutation({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    await ctx.db.patch(args.exchangeId, {
      status: "accepted",
      updatedAt: Date.now(),
    });

    // Create notification for the requester
    await ctx.db.insert("notifications", {
      userId: exchange.initiatorId,
      type: "trade_accepted",
      title: "Exchange Accepted",
      message: "Your trade request has been accepted!",
      relatedId: args.exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Decline trade request
export const declineExchange = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    responseMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    await ctx.db.patch(args.exchangeId, {
      status: "rejected",
      updatedAt: Date.now(),
    });

    // Create notification for the requester
    await ctx.db.insert("notifications", {
      userId: exchange.initiatorId,
      type: "trade_declined",
      title: "Exchange Declined",
      message: "Your trade request has been declined",
      relatedId: args.exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Complete trade request
export const completeExchange = mutation({
  args: {
    exchangeId: v.id("exchanges"),
  },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    await ctx.db.patch(args.exchangeId, {
      status: "completed",
      recipientConfirmationTimestamp: Date.now(),
      updatedAt: Date.now(),
    });

    // Mark puzzles as unavailable
    await ctx.db.patch(exchange.requestedPuzzleId, {
      availability: {
        forTrade: false,
        forSale: false,
        forLend: false,
      },
    });
    if (exchange.offeredPuzzleId) {
      await ctx.db.patch(exchange.offeredPuzzleId, {
        availability: {
          forTrade: false,
          forSale: false,
          forLend: false,
        },
      });
    }

    // Create notification for the other party
    const notificationUserId =
      exchange.initiatorId === exchange.recipientId
        ? exchange.recipientId
        : exchange.initiatorId;

    await ctx.db.insert("notifications", {
      userId: notificationUserId,
      type: "trade_completed",
      title: "Exchange Completed",
      message: "Exchange has been marked as completed",
      relatedId: args.exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Cancel trade request
export const cancelExchange = mutation({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) {
      throw new Error("Exchange request not found");
    }

    await ctx.db.patch(args.exchangeId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // Create notification for the owner
    await ctx.db.insert("notifications", {
      userId: exchange.recipientId,
      type: "trade_cancelled",
      title: "Exchange Cancelled",
      message: "Exchange request has been cancelled",
      relatedId: args.exchangeId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});
