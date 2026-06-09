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

  // Puzzles  - the actual puzzle designs that exist in the world
  puzzles: defineTable({
    // Catalog PuzzleDefinitionId. Optional so legacy rows still validate; the domain-driven
    // catalog functions set+use it, legacy puzzles.ts ignores it.
    aggregateId: v.optional(v.string()),

    // --- Core Info ---
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    artist: v.optional(v.string()),
    series: v.optional(v.string()),

    // --- Identifiers ---
    ean: v.optional(v.string()), // European Article Number (13-digit barcode)
    upc: v.optional(v.string()), // Universal Product Code (12-digit barcode)
    modelNumber: v.optional(v.string()), // Manufacturer's model number

    // --- Physical Details ---
    dimensions: v.optional(
      v.object({
        width: v.number(),
        height: v.number(),
        unit: v.union(v.literal("cm"), v.literal("in")),
      }),
    ),
    shape: v.optional(
      v.union(
        v.literal("rectangular"),
        v.literal("panoramic"),
        v.literal("round"),
        v.literal("shaped"), // For non-standard shapes
      ),
    ),

    // --- Categorization ---
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

    // --- Media & Search ---
    image: v.optional(v.id("_storage")), // The "box art" image
    searchableText: v.optional(v.string()),

    // --- Moderation & Timestamps ---
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    submittedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Add indexes for new, important fields
    .index("by_ean", ["ean"])
    .index("by_upc", ["upc"])
    .index("by_artist", ["artist"])
    .index("by_series", ["series"])
    // Existing indexes are great!
    .index("by_piece_count", ["pieceCount"])
    .index("by_category", ["category"])
    .index("by_difficulty", ["difficulty"])
    .index("by_brand", ["brand"])
    .index("by_tags", ["tags"])
    .index("by_aggregate_id", ["aggregateId"])
    // Lets a contributor list their own submissions (e.g. own not-yet-approved puzzles).
    .index("by_submitted_by", ["submittedBy"])
    .searchIndex("by_searchable_text", {
      searchField: "searchableText",
      // Lets public suggestions exclude pending/rejected submissions at the index level.
      filterFields: ["status"],
    }),

  // Puzzle instances - individual copies that people own
  ownedPuzzles: defineTable({
    // Library CopyId. Optional so legacy rows still validate; the domain-driven library
    // functions set+use it, legacy puzzles.ts ignores it.
    aggregateId: v.optional(v.string()),

    // --- Core Links ---
    puzzleId: v.id("puzzles"), // Renamed from puzzleId for clarity
    // The Catalog PuzzleDefinitionId (aggregateId) the Copy instantiates. Held alongside the
    // legacy puzzleId so the domain path references Catalog by aggregate id, not Convex _id.
    puzzleDefinitionId: v.optional(v.string()),
    // The cached Catalog snapshot (ACL) the Copy carries; refreshed via the snapshot provider.
    snapshot: v.optional(
      v.object({
        title: v.string(),
        brand: v.optional(v.string()),
        pieceCount: v.number(),
        thumbnail: v.optional(v.string()),
      }),
    ),
    ownerId: v.id("users"),

    // --- Condition ---
    condition: v.union(
      v.literal("new_sealed"), // More specific than 'excellent'
      v.literal("like_new"), // Opened but perfect
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
    missingPiecesCount: v.optional(v.number()), // Undefined means unknown
    notes: v.optional(v.string()), // Personal notes, e.g., "corner piece is a bit bent"

    // --- Availability for Exchange ---
    availability: v.object({
      forTrade: v.boolean(),
      forSale: v.boolean(),
      forLend: v.boolean(),
    }),
    // The SharingSetting's visibility axis (who can SEE the copy), orthogonal to the
    // availability flags (what it can be USED for). Optional; legacy rows are unset.
    visibility: v.optional(v.union(v.literal("private"), v.literal("visible"))),
    salePrice: v.optional(
      v.object({
        amount: v.number(),
        currency: v.string(), // e.g., "USD", "EUR"
      }),
    ),

    // --- History & Media ---
    acquisitionDate: v.optional(v.number()),
    acquisitionSource: v.optional(
      v.union(
        v.literal("bought_new"),
        v.literal("bought_used"),
        v.literal("trade"),
        v.literal("gift"),
      ),
    ),
    // The Acquisition price the domain models but the legacy column lacked.
    acquisitionPrice: v.optional(
      v.object({
        amount: v.number(),
        currency: v.string(),
      }),
    ),

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_puzzle", ["puzzleId"])
    // You might want a more complex index for finding available puzzles
    .index("by_owner_and_availability", ["ownerId", "availability"])
    .index("by_aggregate_id", ["aggregateId"]),

  // This is a table for storing images of owned puzzles
  ownedPuzzleImages: defineTable({
    // Link to the specific puzzle copy
    ownedPuzzleId: v.id("ownedPuzzles"),
    // The user who uploaded this specific image
    uploaderId: v.id("users"),
    // The actual image file in storage
    fileId: v.id("_storage"),

    // --- User-provided Metadata ---
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    // You could use a union of literals for specific photo types
    tag: v.optional(
      v.union(
        v.literal("box_front"),
        v.literal("box_back"),
        v.literal("pieces"),
        v.literal("completed"),
        v.literal("damage_detail"),
      ),
    ),
    // The date the photo was taken
    takenAt: v.optional(v.number()),

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owned_puzzle", ["ownedPuzzleId"]),

  // Named collections for organizing puzzles
  collections: defineTable({
    // Library CollectionId. Optional so legacy rows still validate; the domain-driven library
    // functions set+use it, legacy collections.ts ignores it.
    aggregateId: v.optional(v.string()),

    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.union(v.literal("private"), v.literal("public")),
    color: v.optional(v.string()), // hex color code
    icon: v.optional(v.string()), // emoji or icon name
    isDefault: v.boolean(), // true for system collections like "Favorites"
    // Wishlist variant: a wishlist references desired PuzzleDefinitionIds, a regular collection
    // its members' CopyIds. Optional; legacy rows are regular collections.
    isWishlist: v.optional(v.boolean()),
    // Desired Catalog PuzzleDefinitionIds (aggregateIds) for the wishlist variant.
    wishedDefinitions: v.optional(v.array(v.string())),
    personalNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"])
    .index("by_visibility", ["visibility"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Collection membership - many-to-many relationship (now references ownedPuzzles)
  collectionMembers: defineTable({
    collectionId: v.id("collections"),
    ownedPuzzleId: v.id("ownedPuzzles"),
    addedAt: v.number(),
  })
    .index("by_collection", ["collectionId"])
    .index("by_owned_puzzle", ["ownedPuzzleId"])
    .index("by_collection_owned_puzzle", ["collectionId", "ownedPuzzleId"]),

  // Completion records for puzzles (can reference either puzzles or ownedPuzzles)
  completions: defineTable({
    // Solving CompletionId. Optional so legacy rows still validate; the domain-driven solving
    // functions set+use it, legacy code ignores it.
    aggregateId: v.optional(v.string()),

    userId: v.id("users"),
    puzzleId: v.optional(v.id("puzzles")), // Reference to puzzle (for general completions)
    ownedPuzzleId: v.optional(v.id("ownedPuzzles")), // Reference to specific instance (for specific completions)
    startDate: v.number(),
    // Optional so an in-progress completion (started, not yet finished) can be persisted; a
    // finished completion always carries both. Existing rows already hold values.
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
    rating: v.optional(v.number()), // 1-5 stars
    review: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.array(v.id("_storage")), // Array of photo URLs (max 5)
    isCompleted: v.boolean(), // true = completed, false = in progress
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle", ["puzzleId"])
    .index("by_owned_puzzle", ["ownedPuzzleId"])
    .index("by_user_puzzle", ["userId", "puzzleId"])
    .index("by_user_owned_puzzle", ["userId", "ownedPuzzleId"])
    .index("by_completion_date", ["endDate"])
    .index("by_rating", ["rating"])
    .index("by_aggregate_id", ["aggregateId"]),

  // User-defined categories for organizing collections
  categories: defineTable({
    // Library PersonalCategoryId. Optional so legacy rows still validate; the domain-driven
    // library functions set+use it, legacy code ignores it.
    aggregateId: v.optional(v.string()),

    userId: v.id("users"),
    name: v.string(),
    color: v.optional(v.string()), // hex color code
    description: v.optional(v.string()),
    isDefault: v.boolean(), // true for system categories, false for user-created
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Admin-managed global categories with localization support
  adminCategories: defineTable({
    // Catalog CatalogCategoryId. Optional so legacy rows still validate; the domain-driven
    // catalog functions set+use it, legacy adminCategories.ts ignores it.
    aggregateId: v.optional(v.string()),

    name: v.object({
      en: v.string(),
      nl: v.string(),
    }),
    description: v.optional(
      v.object({
        en: v.string(),
        nl: v.string(),
      }),
    ),
    color: v.optional(v.string()), // hex color code
    isActive: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_sort_order", ["sortOrder"])
    .index("by_aggregate_id", ["aggregateId"]),

  // User goals for puzzle completion
  goals: defineTable({
    // Solving GoalId. Optional so legacy rows still validate; the domain-driven solving
    // functions set+use it, legacy code ignores it.
    aggregateId: v.optional(v.string()),

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
    .index("by_user_active", ["userId", "isActive"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Exchanges are the core of the app. They are the way users can trade, buy, and sell puzzles.
  exchanges: defineTable({
    // Domain aggregate identity (ExchangeId). Optional so pre-existing rows still validate;
    // the new domain-driven functions set+use it. Legacy functions ignore it.
    aggregateId: v.optional(v.string()),

    // --- Participants ---
    initiatorId: v.id("users"),
    recipientId: v.id("users"),

    // --- Exchange Details ---
    type: v.union(v.literal("trade"), v.literal("sale"), v.literal("loan")),
    // The puzzle being offered by the initiator.
    // For a trade, this is the item being offered by the initiator.
    // For a loan or a sale, this is null.
    offeredPuzzleId: v.optional(v.id("ownedPuzzles")),
    // The puzzle being requested from the recipient.
    // For a trade, this is the item being requested from the recipient.
    // For a loan, this is the item being borrowed.
    // For a sale, this is the item being bought.
    requestedPuzzleId: v.id("ownedPuzzles"),

    // Optional fields for sales and loans
    salePrice: v.optional(
      v.object({
        amount: v.number(),
        currency: v.string(),
      }),
    ),
    loanReturnDate: v.optional(v.number()),

    // --- State Management ---
    status: v.union(
      v.literal("proposed"), // Initial offer
      v.literal("accepted"), // Both parties agreed, awaiting physical exchange
      v.literal("completed"), // Transaction is fully and successfully finished
      v.literal("rejected"), // Offer was declined
      v.literal("cancelled"), // Agreed-upon deal was cancelled by a user
      v.literal("disputed"), // A user has flagged an issue with the exchange
    ),

    // --- Confirmation Timestamps ---
    // Timestamp for when the initiator confirms they have received their item.
    initiatorConfirmationTimestamp: v.optional(v.number()),
    // Timestamp for when the recipient confirms they have received their item.
    recipientConfirmationTimestamp: v.optional(v.number()),

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_initiator", ["initiatorId", "offeredPuzzleId"])
    .index("by_recipient", ["recipientId", "offeredPuzzleId"])
    .index("by_aggregate_id", ["aggregateId"]),

  messages: defineTable({
    exchangeId: v.id("exchanges"),
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
    .index("by_exchange", ["exchangeId"])
    .index("by_sender", ["senderId"])
    .index("by_receiver", ["receiverId"])
    .index("by_created_at", ["createdAt"]),

  reviews: defineTable({
    exchangeId: v.id("exchanges"),
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
    .index("by_exchange", ["exchangeId"])
    .index("by_rating", ["rating"]),

  favorites: defineTable({
    userId: v.id("users"),
    puzzleId: v.id("puzzles"), // Now favorites reference puzzles
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
