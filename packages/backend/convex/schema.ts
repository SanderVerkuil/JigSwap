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

  // Puzzle products - the actual puzzle designs that exist in the world
  puzzleProducts: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    category: v.optional(v.id("adminCategories")),
    tags: v.optional(v.array(v.string())),
    image: v.optional(v.string()),
    searchableText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_piece_count", ["pieceCount"])
    .index("by_category", ["category"])
    .index("by_difficulty", ["difficulty"])
    .index("by_brand", ["brand"])
    .searchIndex("by_searchable_text", {
      searchField: "searchableText",
    }),

  // Puzzle instances - individual copies that people own
  puzzleInstances: defineTable({
    productId: v.id("puzzleProducts"), // Reference to the puzzle product
    ownerId: v.id("users"),
    condition: v.union(
      v.literal("excellent"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
    isAvailable: v.boolean(),
    images: v.optional(v.array(v.string())),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_product", ["productId"])
    .index("by_availability", ["isAvailable"]),

  // Named collections for organizing puzzles
  collections: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.union(
      v.literal("private"),
      v.literal("public"),
    ),
    color: v.optional(v.string()), // hex color code
    icon: v.optional(v.string()), // emoji or icon name
    isDefault: v.boolean(), // true for system collections like "Favorites"
    personalNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"])
    .index("by_visibility", ["visibility"]),

  // Collection membership - many-to-many relationship (now references puzzleInstances)
  collectionMembers: defineTable({
    collectionId: v.id("collections"),
    puzzleInstanceId: v.id("puzzleInstances"),
    addedAt: v.number(),
  })
    .index("by_collection", ["collectionId"])
    .index("by_puzzle_instance", ["puzzleInstanceId"])
    .index("by_collection_puzzle_instance", ["collectionId", "puzzleInstanceId"]),

  // Completion records for puzzles (can reference either puzzleProducts or puzzleInstances)
  completions: defineTable({
    userId: v.id("users"),
    puzzleProductId: v.optional(v.id("puzzleProducts")), // Reference to puzzle product (for general completions)
    puzzleInstanceId: v.optional(v.id("puzzleInstances")), // Reference to specific instance (for specific completions)
    startDate: v.number(),
    endDate: v.number(),
    completionTimeMinutes: v.number(),
    rating: v.optional(v.number()), // 1-5 stars
    review: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.array(v.string()), // Array of photo URLs (max 5)
    isCompleted: v.boolean(), // true = completed, false = in progress
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle_product", ["puzzleProductId"])
    .index("by_puzzle_instance", ["puzzleInstanceId"])
    .index("by_user_puzzle_product", ["userId", "puzzleProductId"])
    .index("by_user_puzzle_instance", ["userId", "puzzleInstanceId"])
    .index("by_completion_date", ["endDate"])
    .index("by_rating", ["rating"]),

  // User-defined categories for organizing collections
  categories: defineTable({
    userId: v.id("users"),
    name: v.string(),
    color: v.optional(v.string()), // hex color code
    description: v.optional(v.string()),
    isDefault: v.boolean(), // true for system categories, false for user-created
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  // Admin-managed global categories with localization support
  adminCategories: defineTable({
    name: v.object({
      en: v.string(),
      nl: v.string(),
    }),
    description: v.optional(v.object({
      en: v.string(),
      nl: v.string(),
    })),
    color: v.optional(v.string()), // hex color code
    isActive: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_sort_order", ["sortOrder"]),

  // User goals for puzzle completion
  goals: defineTable({
    userId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    targetCompletions: v.number(),
    currentCompletions: v.number(),
    targetDate: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_active", ["userId", "isActive"]),

  tradeRequests: defineTable({
    requesterId: v.id("users"),
    ownerId: v.id("users"),
    requesterPuzzleInstanceId: v.optional(v.id("puzzleInstances")), // Puzzle instance offered by requester
    ownerPuzzleInstanceId: v.id("puzzleInstances"), // Puzzle instance requested from owner
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    message: v.optional(v.string()),
    responseMessage: v.optional(v.string()),
    proposedTradeDate: v.optional(v.number()),
    actualTradeDate: v.optional(v.number()),
    shippingMethod: v.optional(
      v.union(v.literal("pickup"), v.literal("mail"), v.literal("meetup")),
    ),
    trackingInfo: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requester", ["requesterId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_requester_puzzle_instance", ["requesterPuzzleInstanceId"])
    .index("by_owner_puzzle_instance", ["ownerPuzzleInstanceId"]),

  messages: defineTable({
    tradeRequestId: v.id("tradeRequests"),
    senderId: v.id("users"),
    receiverId: v.id("users"),
    content: v.string(),
    messageType: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("system"),
    ),
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
    puzzleProductId: v.id("puzzleProducts"), // Now favorites reference puzzle products
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle_product", ["puzzleProductId"])
    .index("by_user_puzzle_product", ["userId", "puzzleProductId"]),

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
      v.literal("puzzle_favorited"),
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
