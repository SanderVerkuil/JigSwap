import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    username: v.optional(v.string()),
    avatar: v.optional(v.string()),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_username", ["username"]),

  puzzles: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"), v.literal("expert"))),
    condition: v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor")),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    images: v.array(v.string()), // Array of image URLs
    ownerId: v.id("users"),
    isAvailable: v.boolean(),
    isCompleted: v.boolean(),
    completedDate: v.optional(v.number()),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_availability", ["isAvailable"])
    .index("by_piece_count", ["pieceCount"])
    .index("by_category", ["category"])
    .index("by_difficulty", ["difficulty"]),

  tradeRequests: defineTable({
    requesterId: v.id("users"),
    ownerId: v.id("users"),
    requesterPuzzleId: v.optional(v.id("puzzles")), // Puzzle offered by requester
    ownerPuzzleId: v.id("puzzles"), // Puzzle requested from owner
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    message: v.optional(v.string()),
    responseMessage: v.optional(v.string()),
    proposedTradeDate: v.optional(v.number()),
    actualTradeDate: v.optional(v.number()),
    shippingMethod: v.optional(v.union(v.literal("pickup"), v.literal("mail"), v.literal("meetup"))),
    trackingInfo: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requester", ["requesterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_requester_puzzle", ["requesterPuzzleId"])
    .index("by_owner_puzzle", ["ownerPuzzleId"]),

  messages: defineTable({
    tradeRequestId: v.id("tradeRequests"),
    senderId: v.id("users"),
    receiverId: v.id("users"),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("system")),
    isRead: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_trade_request", ["tradeRequestId"])
    .index("by_sender", ["senderId"])
    .index("by_receiver", ["receiverId"])
    .index("by_created_at", ["createdAt"]),

  reviews: defineTable({
    tradeRequestId: v.id("tradeRequests"),
    reviewerId: v.id("users"),
    revieweeId: v.id("users"),
    rating: v.number(), // 1-5 stars
    comment: v.optional(v.string()),
    categories: v.object({
      communication: v.number(),
      packaging: v.number(),
      condition: v.number(),
      timeliness: v.number(),
    }),
    createdAt: v.number(),
  })
    .index("by_reviewer", ["reviewerId"])
    .index("by_reviewee", ["revieweeId"])
    .index("by_trade_request", ["tradeRequestId"])
    .index("by_rating", ["rating"]),

  favorites: defineTable({
    userId: v.id("users"),
    puzzleId: v.id("puzzles"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle", ["puzzleId"])
    .index("by_user_puzzle", ["userId", "puzzleId"]),

  notifications: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("trade_request"),
      v.literal("trade_accepted"),
      v.literal("trade_declined"),
      v.literal("trade_completed"),
      v.literal("trade_cancelled"),
      v.literal("message_received"),
      v.literal("review_received"),
      v.literal("puzzle_favorited")
    ),
    title: v.string(),
    message: v.string(),
    relatedId: v.optional(v.string()), // ID of related entity (trade, puzzle, etc.)
    isRead: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_read_status", ["isRead"])
    .index("by_created_at", ["createdAt"]),
});