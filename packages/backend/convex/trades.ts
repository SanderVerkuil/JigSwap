import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a trade request
export const createTradeRequest = mutation({
  args: {
    requesterId: v.id("users"),
    ownerId: v.id("users"),
    requesterPuzzleId: v.optional(v.id("puzzles")),
    ownerPuzzleId: v.id("puzzles"),
    message: v.optional(v.string()),
    proposedTradeDate: v.optional(v.number()),
    shippingMethod: v.optional(v.union(v.literal("pickup"), v.literal("mail"), v.literal("meetup"))),
  },
  handler: async (ctx, args) => {
    // Validate that the requester is not the owner
    if (args.requesterId === args.ownerId) {
      throw new Error("Cannot create trade request with yourself");
    }

    // Validate that the owner puzzle exists and is available
    const ownerPuzzle = await ctx.db.get(args.ownerPuzzleId);
    if (!ownerPuzzle || !ownerPuzzle.isAvailable) {
      throw new Error("Requested puzzle is not available");
    }

    // Validate that the requester puzzle exists and is available (if provided)
    if (args.requesterPuzzleId) {
      const requesterPuzzle = await ctx.db.get(args.requesterPuzzleId);
      if (!requesterPuzzle || !requesterPuzzle.isAvailable) {
        throw new Error("Offered puzzle is not available");
      }
      if (requesterPuzzle.ownerId !== args.requesterId) {
        throw new Error("You can only offer your own puzzles");
      }
    }

    // Check if there's already a pending trade request for this combination
    const existingRequest = await ctx.db
      .query("tradeRequests")
      .filter((q) => 
        q.and(
          q.eq(q.field("requesterId"), args.requesterId),
          q.eq(q.field("ownerPuzzleId"), args.ownerPuzzleId),
          q.eq(q.field("status"), "pending")
        )
      )
      .first();

    if (existingRequest) {
      throw new Error("You already have a pending trade request for this puzzle");
    }

    const now = Date.now();
    const tradeRequestId = await ctx.db.insert("tradeRequests", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Create notification for the owner
    await ctx.db.insert("notifications", {
      userId: args.ownerId,
      type: "trade_request",
      title: "New Trade Request",
      message: "Someone wants to trade for one of your puzzles",
      relatedId: tradeRequestId,
      isRead: false,
      createdAt: now,
    });

    return tradeRequestId;
  },
});

// Get trade request by ID
export const getTradeRequestById = query({
  args: { tradeRequestId: v.id("tradeRequests") },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) return null;

    // Get related data
    const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
      ctx.db.get(tradeRequest.requesterId),
      ctx.db.get(tradeRequest.ownerId),
      ctx.db.get(tradeRequest.ownerPuzzleId),
      tradeRequest.requesterPuzzleId ? ctx.db.get(tradeRequest.requesterPuzzleId) : null,
    ]);

    return {
      ...tradeRequest,
      requester,
      owner,
      ownerPuzzle,
      requesterPuzzle,
    };
  },
});

// Get trade requests for a user (as requester or owner)
export const getUserTradeRequests = query({
  args: { 
    userId: v.id("users"),
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("completed"), v.literal("cancelled"))),
    asRequester: v.optional(v.boolean()),
    asOwner: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let tradeRequests: any[] = [];

    // Get requests where user is the requester
    if (args.asRequester !== false) {
      const requesterTrades = await ctx.db
        .query("tradeRequests")
        .withIndex("by_requester", (q) => q.eq("requesterId", args.userId))
        .collect();
      tradeRequests.push(...requesterTrades.map(tr => ({ ...tr, userRole: "requester" })));
    }

    // Get requests where user is the owner
    if (args.asOwner !== false) {
      const ownerTrades = await ctx.db
        .query("tradeRequests")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
        .collect();
      tradeRequests.push(...ownerTrades.map(tr => ({ ...tr, userRole: "owner" })));
    }

    // Filter by status if provided
    if (args.status) {
      tradeRequests = tradeRequests.filter(tr => tr.status === args.status);
    }

    // Sort by creation date (newest first)
    tradeRequests.sort((a, b) => b.createdAt - a.createdAt);

    // Get related data for each trade request
    const enrichedTradeRequests = await Promise.all(
      tradeRequests.map(async (tr) => {
        const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
          ctx.db.get(tr.requesterId),
          ctx.db.get(tr.ownerId),
          ctx.db.get(tr.ownerPuzzleId),
          tr.requesterPuzzleId ? ctx.db.get(tr.requesterPuzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          ownerPuzzle,
          requesterPuzzle,
        };
      })
    );

    return enrichedTradeRequests;
  },
});

// Update trade request status
export const updateTradeRequestStatus = mutation({
  args: {
    tradeRequestId: v.id("tradeRequests"),
    status: v.union(v.literal("accepted"), v.literal("declined"), v.literal("completed"), v.literal("cancelled")),
    responseMessage: v.optional(v.string()),
    actualTradeDate: v.optional(v.number()),
    trackingInfo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tradeRequestId, status, ...updates } = args;
    
    const tradeRequest = await ctx.db.get(tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    await ctx.db.patch(tradeRequestId, {
      status,
      ...updates,
      updatedAt: Date.now(),
    });

    // Create notification for the other party
    const notificationUserId = status === "accepted" || status === "declined" 
      ? tradeRequest.requesterId 
      : tradeRequest.ownerId;

    const notificationMessages = {
      accepted: "Your trade request has been accepted!",
      declined: "Your trade request has been declined",
      completed: "Trade has been marked as completed",
      cancelled: "Trade request has been cancelled",
    };

    await ctx.db.insert("notifications", {
      userId: notificationUserId,
      type: `trade_${status}` as any,
      title: `Trade ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessages[status],
      relatedId: tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });

    // If trade is completed, mark puzzles as unavailable
    if (status === "completed") {
      await ctx.db.patch(tradeRequest.ownerPuzzleId, { isAvailable: false });
      if (tradeRequest.requesterPuzzleId) {
        await ctx.db.patch(tradeRequest.requesterPuzzleId, { isAvailable: false });
      }
    }
  },
});

// Get trade statistics
export const getTradeStats = query({
  args: {},
  handler: async (ctx) => {
    const allTrades = await ctx.db.query("tradeRequests").collect();
    
    const stats = {
      total: allTrades.length,
      pending: allTrades.filter(t => t.status === "pending").length,
      accepted: allTrades.filter(t => t.status === "accepted").length,
      completed: allTrades.filter(t => t.status === "completed").length,
      declined: allTrades.filter(t => t.status === "declined").length,
      cancelled: allTrades.filter(t => t.status === "cancelled").length,
    };

    return stats;
  },
});

// Send message in trade request
export const sendTradeMessage = mutation({
  args: {
    tradeRequestId: v.id("tradeRequests"),
    senderId: v.id("users"),
    content: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("system"))),
  },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    // Determine receiver
    const receiverId = args.senderId === tradeRequest.requesterId 
      ? tradeRequest.ownerId 
      : tradeRequest.requesterId;

    const messageId = await ctx.db.insert("messages", {
      tradeRequestId: args.tradeRequestId,
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
      relatedId: args.tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });

    return messageId;
  },
});

// Get messages for a trade request
export const getTradeMessages = query({
  args: { tradeRequestId: v.id("tradeRequests") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_trade_request", (q) => q.eq("tradeRequestId", args.tradeRequestId))
      .collect();

    // Get sender information for each message
    const messagesWithSenders = await Promise.all(
      messages.map(async (message) => {
        const sender = await ctx.db.get(message.senderId);
        return {
          ...message,
          sender: sender ? {
            _id: sender._id,
            name: sender.name,
            avatar: sender.avatar,
          } : null,
        };
      })
    );

    return messagesWithSenders.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Get trade requests by owner
export const getTradeRequestsByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, args) => {
    const tradeRequests = await ctx.db
      .query("tradeRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    // Get related data for each trade request
    const enrichedTradeRequests = await Promise.all(
      tradeRequests.map(async (tr) => {
        const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
          ctx.db.get(tr.requesterId),
          ctx.db.get(tr.ownerId),
          ctx.db.get(tr.ownerPuzzleId),
          tr.requesterPuzzleId ? ctx.db.get(tr.requesterPuzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          ownerPuzzle,
          requesterPuzzle,
        };
      })
    );

    return enrichedTradeRequests.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get trade requests by requester
export const getTradeRequestsByRequester = query({
  args: { requesterId: v.id("users") },
  handler: async (ctx, args) => {
    const tradeRequests = await ctx.db
      .query("tradeRequests")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.requesterId))
      .collect();

    // Get related data for each trade request
    const enrichedTradeRequests = await Promise.all(
      tradeRequests.map(async (tr) => {
        const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
          ctx.db.get(tr.requesterId),
          ctx.db.get(tr.ownerId),
          ctx.db.get(tr.ownerPuzzleId),
          tr.requesterPuzzleId ? ctx.db.get(tr.requesterPuzzleId) : null,
        ]);

        return {
          ...tr,
          requester,
          owner,
          ownerPuzzle,
          requesterPuzzle,
        };
      })
    );

    return enrichedTradeRequests.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Accept trade request
export const acceptTradeRequest = mutation({
  args: { tradeRequestId: v.id("tradeRequests") },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    await ctx.db.patch(args.tradeRequestId, {
      status: "accepted",
      updatedAt: Date.now(),
    });

    // Create notification for the requester
    await ctx.db.insert("notifications", {
      userId: tradeRequest.requesterId,
      type: "trade_accepted",
      title: "Trade Accepted",
      message: "Your trade request has been accepted!",
      relatedId: args.tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Decline trade request
export const declineTradeRequest = mutation({
  args: {
    tradeRequestId: v.id("tradeRequests"),
    responseMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    await ctx.db.patch(args.tradeRequestId, {
      status: "declined",
      responseMessage: args.responseMessage,
      updatedAt: Date.now(),
    });

    // Create notification for the requester
    await ctx.db.insert("notifications", {
      userId: tradeRequest.requesterId,
      type: "trade_declined",
      title: "Trade Declined",
      message: "Your trade request has been declined",
      relatedId: args.tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Complete trade request
export const completeTradeRequest = mutation({
  args: {
    tradeRequestId: v.id("tradeRequests"),
    actualTradeDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    await ctx.db.patch(args.tradeRequestId, {
      status: "completed",
      actualTradeDate: args.actualTradeDate || Date.now(),
      updatedAt: Date.now(),
    });

    // Mark puzzles as unavailable
    await ctx.db.patch(tradeRequest.ownerPuzzleId, { isAvailable: false });
    if (tradeRequest.requesterPuzzleId) {
      await ctx.db.patch(tradeRequest.requesterPuzzleId, { isAvailable: false });
    }

    // Create notification for the other party
    const notificationUserId = tradeRequest.requesterId === tradeRequest.requesterId
      ? tradeRequest.ownerId
      : tradeRequest.requesterId;

    await ctx.db.insert("notifications", {
      userId: notificationUserId,
      type: "trade_completed",
      title: "Trade Completed",
      message: "Trade has been marked as completed",
      relatedId: args.tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});

// Cancel trade request
export const cancelTradeRequest = mutation({
  args: { tradeRequestId: v.id("tradeRequests") },
  handler: async (ctx, args) => {
    const tradeRequest = await ctx.db.get(args.tradeRequestId);
    if (!tradeRequest) {
      throw new Error("Trade request not found");
    }

    await ctx.db.patch(args.tradeRequestId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // Create notification for the owner
    await ctx.db.insert("notifications", {
      userId: tradeRequest.ownerId,
      type: "trade_cancelled",
      title: "Trade Cancelled",
      message: "Trade request has been cancelled",
      relatedId: args.tradeRequestId,
      isRead: false,
      createdAt: Date.now(),
    });
  },
});