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
    // Mirror of the Clerk publicMetadata.role claim, synced by the user webhook
    // (users.updateOrCreateUser) and the one-shot backfillUserRoles action. DISPLAY-ONLY:
    // authorization always reads the JWT via identity/isAdmin — never gate on this field.
    role: v.optional(v.string()),
    // Absent or false means the user's avatar image must never appear on public
    // marketing surfaces — initials only. Opt-in; defaults to NOT consented.
    shareAvatarPublicly: v.optional(v.boolean()),
    // Lowercased "<name> <username>" maintained on every user write, backing the
    // people search index so member search is a real index lookup rather than a
    // full-table scan + in-memory filter. Optional so legacy rows still validate.
    searchableName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_username", ["username"])
    .searchIndex("by_searchable_name", {
      searchField: "searchableName",
    }),

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

  // Cache of scraped store pages, keyed on a normalized URL, so repeated pastes of the same link
  // skip re-fetching. TTL is enforced at read time in the extract action (7 days).
  puzzleImportCache: defineTable({
    normalizedUrl: v.string(),
    draft: v.object({
      title: v.string(),
      brand: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      imageAlts: v.optional(v.record(v.string(), v.string())),
      description: v.optional(v.string()),
      ean: v.optional(v.string()),
      upc: v.optional(v.string()),
      pieceCount: v.optional(v.number()),
      sourceUrl: v.string(),
    }),
    fetchedAt: v.number(),
  }).index("by_url", ["normalizedUrl"]),

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
    // Who physically holds the copy now. Equals ownerId unless it is currently lent out, when it
    // is the borrower. Optional: legacy/unset rows are held by their owner.
    heldBy: v.optional(v.id("users")),

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

    // --- Cover ---
    // The copy's chosen cover picture: one of its `ownedPuzzleImages`. Absent means use the
    // puzzle's global catalogue image (the default).
    coverImageId: v.optional(v.id("ownedPuzzleImages")),

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

    // --- Async content moderation (image-moderation pipeline) ---
    // Lifecycle: a freshly uploaded photo is "pending" until the moderatePhoto Node action
    // re-encodes it (strips EXIF) and content-classifies it, then flips it to "approved" or
    // "rejected". ABSENT means the row predates moderation and is treated as "approved" so legacy
    // photos stay visible. The gallery only surfaces approved photos (plus the uploader's own
    // pending ones).
    moderationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
    ),
    // The classifier's NSFW score in [0,1] (null/absent when un-scored, e.g. provider "none" or
    // missing token). Kept for auditability/threshold tuning.
    moderationScore: v.optional(v.number()),
    // The decisive label from the classifier (e.g. "nsfw"/"normal"), for diagnostics.
    moderationLabel: v.optional(v.string()),

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owned_puzzle", ["ownedPuzzleId"])
    .index("by_moderation_status", ["moderationStatus"]),

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
    // Per-solve record: were all pieces present this time? Optional so legacy rows and
    // "didn't say" stay valid. Set by the domain path (record/finish).
    allPiecesPresent: v.optional(v.boolean()),
    // Denormalized, durable snapshot of the copy at completion time. Library-context data the
    // Solving domain never loads, so it is written by the recordCompletion composition root (not
    // the domain mapper). Survives copy deletion; the live `ownedPuzzleId` link may go stale.
    copySnapshot: v.optional(
      v.object({
        copyId: v.string(), // original Library CopyId aggregateId, kept even after deletion
        ownerId: v.id("users"),
        wasBorrowed: v.boolean(), // true if the logger was not the owner
        condition: v.union(
          v.literal("new_sealed"),
          v.literal("like_new"),
          v.literal("good"),
          v.literal("fair"),
          v.literal("poor"),
        ),
        missingPiecesCount: v.optional(v.number()),
        title: v.optional(v.string()),
        brand: v.optional(v.string()),
        pieceCount: v.optional(v.number()),
      }),
    ),
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

  // Admin moderation audit trail: one row per decision, stamped directly by the admin
  // composition roots (catalog approve/reject domain events carry no actor) and by the
  // photo pipeline's auto-rejections (actorId absent = system). Powers the moderation
  // console's KPI week-stats and activity log.
  moderationActions: defineTable({
    actorId: v.optional(v.id("users")), // absent = automated pipeline
    kind: v.union(
      v.literal("definition_approved"),
      v.literal("definition_rejected"),
      v.literal("definition_edited_approved"),
      v.literal("photo_restored"),
      v.literal("photo_removal_confirmed"),
      v.literal("photo_auto_rejected"),
      v.literal("role_granted"),
      v.literal("role_revoked"),
    ),
    targetLabel: v.string(), // denormalized display title at decision time
    targetId: v.string(),
    at: v.number(),
  }).index("by_at", ["at"]),

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
    .index("by_aggregate_id", ["aggregateId"])
    // Back the copy-reservation check: find exchanges referencing a copy as requested/offered
    // without scanning the whole table.
    .index("by_requested_copy", ["requestedPuzzleId"])
    .index("by_offered_copy", ["offeredPuzzleId"]),

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

  // Conversation context. One row per Thread aggregate; messages are companion rows (long chats
  // must not brush the document size limit). participantsKey = the two user _ids sorted and
  // joined with "|" — every thread is a pair in v1, and this backs both the one-DM-per-pair rule
  // and the ConnectionPolicy's "existing thread between the pair" check.
  threads: defineTable({
    aggregateId: v.string(),
    subjectKind: v.union(v.literal("exchange"), v.literal("dm")),
    exchangeId: v.optional(v.id("exchanges")), // set iff subjectKind === "exchange"
    participants: v.array(v.id("users")),
    participantsKey: v.string(),
    readReceipts: v.array(
      v.object({ memberId: v.id("users"), lastReadAt: v.number() }),
    ),
    lastMessageAt: v.optional(v.number()), // denormalized for inbox ordering
    createdAt: v.number(),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_exchange", ["exchangeId"])
    .index("by_subject_participants", ["subjectKind", "participantsKey"])
    .index("by_participants_key", ["participantsKey"]),

  threadMessages: defineTable({
    threadAggregateId: v.string(),
    messageId: v.string(),
    authorId: v.optional(v.id("users")), // absent for system messages
    kind: v.union(v.literal("text"), v.literal("image"), v.literal("system")),
    body: v.string(),
    sentAt: v.number(),
  })
    .index("by_thread_sent", ["threadAggregateId", "sentAt"])
    .index("by_message_id", ["messageId"]),

  // Member-lookup projection of threads.participants, kept in sync by the repository on every
  // save (same pattern as circleMembers — Convex cannot index embedded arrays).
  threadParticipants: defineTable({
    threadAggregateId: v.string(),
    memberId: v.id("users"),
  })
    .index("by_member", ["memberId"])
    .index("by_thread", ["threadAggregateId"]),

  reviews: defineTable({
    // PartnerReview aggregate identity. Optional so pre-existing rows still validate; the new
    // Reputation functions set+use it (backfill stamps legacy rows). Legacy code ignores it.
    aggregateId: v.optional(v.string()),
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
    .index("by_rating", ["rating"])
    .index("by_aggregate_id", ["aggregateId"])
    // Backs the one-review-per-reviewer-per-exchange uniqueness lookup.
    .index("by_exchange_reviewer", ["exchangeId", "reviewerId"]),

  // The per-member ReputationProfile projection: a running aggregate folded from received
  // PartnerReviews. Kept consistent with `reviews` by the in-process publisher (live writes) and
  // the backfill (historical rebuild). `ratingSum`/`reviewCount` retain enough to recompute the
  // average exactly; `credibility` is the 0-1 confidence curve.
  reputationProfiles: defineTable({
    aggregateId: v.optional(v.string()),
    memberId: v.id("users"),
    ratingSum: v.number(),
    reviewCount: v.number(),
    averageRating: v.number(),
    credibility: v.number(),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  favorites: defineTable({
    userId: v.id("users"),
    puzzleId: v.id("puzzles"), // Now favorites reference puzzles
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle", ["puzzleId"])
    .index("by_user_puzzle", ["userId", "puzzleId"]),

  notifications: defineTable({
    // Notification aggregate identity. Optional so pre-existing rows still validate; the domain
    // path sets+uses it (backfill stamps legacy rows). The repository keys saves on it.
    aggregateId: v.optional(v.string()),
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
      // New literals the other contexts now emit (see domain NotificationType).
      v.literal("goal_achieved"),
      v.literal("puzzle_approved"),
      v.literal("puzzle_rejected"),
      v.literal("photo_removed"),
      v.literal("exchange_proposed"),
      v.literal("exchange_disputed"),
    ),
    title: v.string(),
    message: v.string(),
    relatedId: v.optional(v.string()), // ID of related entity (trade, puzzle, etc.)
    // Delivery channel. Optional so legacy rows validate; defaults to "inApp" (backfill stamps it).
    channel: v.optional(v.string()),
    isRead: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_read_status", ["isRead"])
    .index("by_created_at", ["createdAt"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Per-member NotificationPreference: which (type, channel) deliveries the member accepts. One
  // row per member; `toggles` is the resolved type->channel->enabled map (stored as JSON via
  // v.any so the domain shape maps field-for-field without enumerating literals here).
  notificationPreferences: defineTable({
    aggregateId: v.optional(v.string()),
    memberId: v.id("users"),
    toggles: v.any(),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // Solving-context member preferences (federated settings: each context owns its settings).
  // Keyed by member; `trackCompletionDuration` undefined = never asked → first-time prompt.
  solvingPreferences: defineTable({
    memberId: v.id("users"),
    trackCompletionDuration: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // Web Push subscriptions: one row per browser/device a member has granted push permission on. The
  // push channel (notifications/sendWebPush) fans a notification out to every active subscription of
  // the recipient via the Web Push protocol (VAPID). A subscription that the push service reports as
  // permanently gone (HTTP 404/410) is pruned. `endpoint` is the unique push-service URL.
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(), // client public key (base64url) for payload encryption
    auth: v.string(), // client auth secret (base64url)
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  // Friend Circles: a private group whose members share circle-scoped visibility. The Circle
  // aggregate persists as ONE unit (root + its embedded memberships) so every invariant is enforced
  // against the whole set. Member lookup goes through the `circleMembers` junction (below) because
  // Convex can't index into the embedded `memberships` objects.
  circles: defineTable({
    // Domain aggregate identity (CircleId). Keyed on by the repository; never an FK target.
    aggregateId: v.optional(v.string()),
    ownerId: v.id("users"),
    name: v.string(),
    // The aggregate's membership rows, embedded (loaded/saved with the root). `memberId` is the
    // resolved user _id; `id` is the domain MembershipId string.
    memberships: v.array(
      v.object({
        id: v.string(),
        memberId: v.id("users"),
        permission: v.union(
          v.literal("ViewOnly"),
          v.literal("Exchange"),
          v.literal("Admin"),
        ),
        joinedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Member-lookup projection of `circles.memberships`, kept in sync by the repository on every save.
  // Lets "every circle a member belongs to" be an indexed read (Convex can't index embedded arrays).
  // `circleAggregateId` is the domain CircleId string; `memberId` is the resolved user _id.
  circleMembers: defineTable({
    circleAggregateId: v.string(),
    memberId: v.id("users"),
  })
    .index("by_member", ["memberId"])
    .index("by_circle", ["circleAggregateId"])
    .index("by_circle_member", ["circleAggregateId", "memberId"]),

  // Read model of copies shared into a circle, projected from the CopySharedToCircle event. Sharing
  // owns no copy state; this link makes a friend-circle copy discoverable to the circle's members.
  // `copyId` is the Library CopyId aggregateId (string), not a resolved owned-puzzle _id.
  circleCopyShares: defineTable({
    circleId: v.string(),
    copyId: v.string(),
    sharedAt: v.number(),
  })
    .index("by_circle", ["circleId"])
    .index("by_copy", ["copyId"])
    .index("by_circle_copy", ["circleId", "copyId"]),

  // Social: a member's public profile (display name + bio). One row per member; the aggregate
  // is keyed by member, so `by_member` backs findByMember and aggregateId is the ProfileId.
  profiles: defineTable({
    aggregateId: v.optional(v.string()),
    memberId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    // Who can see this profile. Optional so existing rows stay valid; absent means "public".
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    // Ordered, curated set of the member's owned copies featured on their profile shelf
    // (sub-project ④). Optional so existing rows validate; absent/empty = uncurated (recent-6 fallback).
    featuredCopyIds: v.optional(v.array(v.id("ownedPuzzles"))),
    updatedAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Social: a community comment on a PUZZLE DEFINITION (shared across every owned copy of that
  // puzzle). A lightweight, append-only post: trimmed text + optional 1–5 rating + author + when.
  // aggregateId is the CommentId; `by_puzzle` backs the newest-first read keyed on puzzleId.
  puzzleComments: defineTable({
    aggregateId: v.optional(v.string()),
    puzzleId: v.id("puzzles"),
    // Set only for COPY-scoped comments (the owner's notes/rating on one owned copy). Absent rows
    // are community reviews of the shared puzzle definition. Copy-scoped rows are listed by_copy and
    // excluded from the definition's community reviews/rating.
    copyId: v.optional(v.id("ownedPuzzles")),
    authorId: v.id("users"),
    text: v.string(),
    rating: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_puzzle", ["puzzleId"])
    .index("by_copy", ["copyId"]),

  // Social: a text-only discussion comment on a single shared PHOTO (an `ownedPuzzleImages` row),
  // surfaced in the photo lightbox. Keyed by the photo _id (not a puzzle definition); aggregateId is
  // the PhotoCommentId. Append-only — the read side projects this table directly into view DTOs.
  photoComments: defineTable({
    aggregateId: v.optional(v.string()),
    photoId: v.id("ownedPuzzleImages"),
    authorId: v.id("users"),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_photo", ["photoId"]),

  // Social: a directed follow edge (followerId -> followeeId). Indexed both ways so the read side
  // can list a member's followers and the people they follow; aggregateId is the FollowId.
  follows: defineTable({
    aggregateId: v.optional(v.string()),
    followerId: v.id("users"),
    followeeId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_follower", ["followerId"])
    .index("by_followee", ["followeeId"])
    .index("by_follower_followee", ["followerId", "followeeId"])
    .index("by_aggregate_id", ["aggregateId"]),

  // The durable domain-event log: every context's events are appended here, then an async
  // dispatcher (scheduled per insert) routes each to its subscribers and stamps processedAt.
  // WHY durable: decouples subscribers (Notifications, future Insights/Social) from the emitting
  // transaction while keeping critical reactions (availability, goal recompute) inline.
  domainEvents: defineTable({
    name: v.string(),
    payload: v.any(),
    occurredAt: v.number(),
    context: v.string(),
    processedAt: v.optional(v.number()),
  })
    .index("by_processed", ["processedAt"])
    // Backs the activity feed: pull recent events of a given name in a bounded time window without
    // a full-table scan-and-filter.
    .index("by_name", ["name", "occurredAt"]),

  // Chain-of-Custody projection: one row per OwnershipTransferred event, folded by the custody
  // subscriber off the durable event log. WHY a dedicated table: domainEvents.payload is v.any()
  // with no per-copy index, so transfer history is not queryable by copyId; this read-model makes
  // a Copy's provenance a single indexed scan. Pure projection — keyed by copyId, no aggregateId.
  copyCustodyEntries: defineTable({
    copyId: v.string(), // the transferred Copy's `ownedPuzzles._id` (NOT the aggregateId) — the timeline query indexes by this
    exchangeId: v.string(), // the settling Exchange aggregateId
    previousOwner: v.string(), // the member the Copy moved FROM (a users _id)
    newOwner: v.string(), // the member the Copy moved to (a users _id)
    occurredAt: v.number(),
  }).index("by_copy", ["copyId", "occurredAt"]),

  // Open-ended loans: possession of a Copy held by a borrower while ownership stays with the
  // lender. Closed when the borrower returns it or the owner recalls it. aggregateId = LoanId;
  // copyId is the Library CopyId (ownedPuzzles.aggregateId). Status indexes back the borrowed/lent
  // queries; by_copy backs the loan-history read.
  loans: defineTable({
    aggregateId: v.optional(v.string()),
    copyId: v.string(),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    status: v.union(
      v.literal("open"),
      v.literal("returned"),
      v.literal("recalled"),
    ),
    openedAt: v.number(),
    expectedReturn: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_copy", ["copyId", "openedAt"])
    .index("by_borrower", ["borrowerId", "status"])
    .index("by_lender", ["lenderId", "status"]),

  // Messages from the public marketing contact form. Operational/support data, not a bounded
  // context: written by an unauthenticated thin mutation, read (later) by admin tooling. Status
  // tracks triage.
  contactMessages: defineTable({
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
    status: v.union(v.literal("new"), v.literal("handled")),
    createdAt: v.number(),
  }).index("by_status", ["status", "createdAt"]),

  // Feedback from the public /docs site ("Was this page helpful?"). Operational/support data, not a
  // bounded context: written by an unauthenticated thin mutation, read (later) by admin tooling.
  docFeedback: defineTable({
    slug: v.string(),
    helpful: v.boolean(),
    comment: v.optional(v.string()),
    locale: v.optional(v.string()),
    // Reserved for future authenticated attribution; the public mutation never
    // sets it today (docs are public, so feedback is anonymous).
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_slug", ["slug", "createdAt"]),
});
