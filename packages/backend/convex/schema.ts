import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { hashCheckFields } from "./lib/imageModeration/hashCheckFields";

// The proposable field diff, shared by puzzleChangeProposals.changes and .baseline. Mirrors the
// domain PuzzleDefinitionChanges shape exactly (barcodes grouped: supplying the group replaces
// all three values, same as updatePuzzleDefinition).
const proposalFields = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  brand: v.optional(v.string()),
  publisher: v.optional(v.string()),
  pieceCount: v.optional(v.number()),
  artist: v.optional(v.string()),
  series: v.optional(v.string()),
  barcodes: v.optional(
    v.object({
      ean: v.optional(v.string()),
      upc: v.optional(v.string()),
      modelNumber: v.optional(v.string()),
    }),
  ),
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
      v.literal("shaped"),
    ),
  ),
  difficulty: v.optional(
    v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
      v.literal("expert"),
    ),
  ),
  category: v.optional(v.string()), // CatalogCategoryId aggregate id string
  tags: v.optional(v.array(v.string())),
  image: v.optional(v.string()), // _storage id as plain string (domain-owned shape)
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    // The member's VERIFIED primary Clerk email (users.updateOrCreateUser). Optional: a member whose
    // primary address is not (yet) verified, or who has none, has no email — email notifications
    // are skipped for them.
    email: v.optional(v.string()),
    // Full name as synced from Clerk ("<first> <last>", either half may be missing). Optional:
    // Clerk users without a first/last name have none — render via resolveMemberDisplayName
    // (@jigswap/contracts), never the raw field.
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    // Member-chosen, Convex-owned profile handle (e.g. "sander-verkuil"). Unlike `username`
    // (Clerk-owned, synced by the webhook), this is set directly via identity/setSlug and
    // enforced unique in-mutation (Convex has no unique constraint). Optional: most rows have none.
    slug: v.optional(v.string()),
    avatar: v.optional(v.string()),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    isActive: v.boolean(),
    // Mirror of the Clerk publicMetadata.role claim, synced by the user webhook
    // (users.updateOrCreateUser) and the one-shot backfillUserRoles action. DISPLAY +
    // NOTIFICATION TARGETING only: authorization always reads the JWT via identity/isAdmin —
    // never gate on this field.
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
    .index("by_slug", ["slug"])
    .index("by_role", ["role"])
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
    publisher: v.optional(v.string()),
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
      v.literal("disabled"),
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
    .index("by_publisher", ["publisher"])
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
    // availability flags (what it can be USED for). Optional; legacy rows are unset. Convex has no
    // column defaults: the "visible" default lives in the create paths (domain SharingSetting.newCopy)
    // and in library/copyVisibility.effectiveCopyVisibility. NEVER read this column directly to
    // decide who may see a copy — always go through effectiveCopyVisibility.
    visibility: v.optional(v.union(v.literal("private"), v.literal("visible"))),
    // Rollout marker: true when `visibility` was written by an authoritative source (the domain
    // repository on any save, or the one-shot backfill library/backfillCopyVisibility). Rows without
    // it predate the per-copy privacy toggle: their stored "private" was the old domain default, not
    // an owner's choice, so effectiveCopyVisibility treats them as "visible" until backfilled. Can be
    // dropped (and the helper simplified) once the backfill has run on every deployment.
    visibilityAuthoritative: v.optional(v.boolean()),
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
    // The quick-start batch (one library.acquireCopies call) that added this copy; the same id is
    // on its CopyAcquired event. Absent for a single add and for every legacy row. Provenance only:
    // written once by acquireCopies, not part of the Library domain model or any copy view.
    acquisitionBatchId: v.optional(v.string()),

    // --- Household ---
    // What the owner lets their household do with this copy: "manage" (act as co-owner) or "view".
    // ABSENT means the default ("manage") — existing copies need no backfill. Cleared when ownership
    // moves (the permission was the previous owner's choice). See households design spec.
    householdPermission: v.optional(
      v.union(v.literal("manage"), v.literal("view")),
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
    // "rejected" — or "unscored" when the classifier could not check it (provider error / missing
    // token) after its retries. ABSENT means the row predates moderation and is treated as
    // "approved" so legacy photos stay visible. The gallery only surfaces approved photos (plus the
    // uploader's own pending/unscored ones).
    // "Checked & clean" is approved WITH a moderationScore; approved without a score is unknown
    // (legacy, provider "none", or the old fail-open pipeline) and is what the re-screen covers.
    moderationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("unscored"),
        // A CSAM hash-list match (lib/imageModeration/csamHashCheck): never delivered and never
        // served to anyone (admins included); the blob is preserved. See csamEscalations.
        v.literal("quarantined"),
      ),
    ),
    // The classifier's NSFW score in [0,1] (absent when un-scored, e.g. provider "none" or
    // missing token). Kept for auditability/threshold tuning.
    moderationScore: v.optional(v.number()),
    // The decisive label from the classifier (e.g. "nsfw"/"normal"), for diagnostics.
    moderationLabel: v.optional(v.string()),
    // Why an "unscored" photo could not be checked (UnscoredReason), and how many classification
    // attempts the pipeline made. Absent on rows decided before these existed.
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
    // Blurhash (lib/blurhash, 4x3) of the clean image, computed during the re-encode. Shown to
    // other members in place of a photo that is still pending/unscored; never exposed for a
    // rejected one. Absent on rows processed before it existed or whose decode failed.
    blurhash: v.optional(v.string()),
    // When the moderation pipeline swapped the row to its re-encoded (EXIF/GPS-stripped) blob, or
    // re-stored a WebP under its real type. Absent = the stored blob is still the upload as sent;
    // the pipeline re-encodes on any attempt until this is set.
    reencodedAt: v.optional(v.number()),
    // The admin who decided this photo by hand (approve/reject of a pending or unscored photo).
    // A manual decision is final: the re-screen backfill skips such rows.
    moderatedBy: v.optional(v.id("users")),
    // CSAM hash-check bookkeeping + publication gate (lib/imageModeration/hashCheckFields).
    ...hashCheckFields,

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owned_puzzle", ["ownedPuzzleId"])
    .index("by_moderation_status", ["moderationStatus"])
    .index("by_hash_check_pending", ["hashCheckPendingSince"]),

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
    // How precisely a FINISHED solve is dated. Absent = "day" (every legacy row, and every new
    // dated row: writers store it only when it isn't "day", so no backfill is needed). "year" and
    // "unknown" rows hold sentinel dates and no duration; every reader uses `?? "day"`.
    datePrecision: v.optional(v.union(v.literal("year"), v.literal("unknown"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_puzzle", ["puzzleId"])
    .index("by_owned_puzzle", ["ownedPuzzleId"])
    .index("by_user_puzzle", ["userId", "puzzleId"])
    .index("by_user_owned_puzzle", ["userId", "ownedPuzzleId"])
    .index("by_completion_date", ["endDate"])
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_user_completed", ["userId", "isCompleted"]),

  // Moderation sidecars for completion photos (completions.photos storage ids). One row per photo;
  // absent moderationStatus = legacy approved. The moderation pipeline may SWAP fileId (re-encode)
  // — it patches this row and the completions.photos entry together.
  completionImages: defineTable({
    completionId: v.string(), // Solving CompletionId aggregateId
    uploaderId: v.id("users"),
    fileId: v.id("_storage"),
    // Same lifecycle as ownedPuzzleImages.moderationStatus (incl. "unscored").
    moderationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("unscored"),
        // A CSAM hash-list match (lib/imageModeration/csamHashCheck): never delivered and never
        // served to anyone (admins included); the blob is preserved. See csamEscalations.
        v.literal("quarantined"),
      ),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
    // Blurhash (lib/blurhash, 4x3) of the clean image, computed during the re-encode. Shown to
    // other members in place of a photo that is still pending/unscored; never exposed for a
    // rejected one. Absent on rows processed before it existed or whose decode failed.
    blurhash: v.optional(v.string()),
    // When the moderation pipeline swapped the row to its re-encoded (EXIF/GPS-stripped) blob, or
    // re-stored a WebP under its real type. Absent = the stored blob is still the upload as sent;
    // the pipeline re-encodes on any attempt until this is set.
    reencodedAt: v.optional(v.number()),
    // The admin who decided this photo by hand (approve/reject of a pending or unscored photo).
    // A manual decision is final: the re-screen backfill skips such rows.
    moderatedBy: v.optional(v.id("users")),
    // CSAM hash-check bookkeeping + publication gate (lib/imageModeration/hashCheckFields).
    ...hashCheckFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_completion", ["completionId"])
    .index("by_moderation_status", ["moderationStatus"])
    .index("by_hash_check_pending", ["hashCheckPendingSince"]),

  // One review per (member, puzzle definition). `rating` is optional ONLY to
  // hold migrated text-only legacy reviews (the old catalog form required text,
  // stars optional); every new write supplies a rating. At least one of
  // rating/text is always present.
  puzzleReviews: defineTable({
    userId: v.id("users"),
    puzzleId: v.id("puzzles"),
    rating: v.optional(v.number()),
    text: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_puzzle", ["puzzleId"])
    .index("by_user_puzzle", ["userId", "puzzleId"]),

  // One star-only review per (member, physical copy). Write-gated to the
  // copy's owner or a member with a completion on the copy.
  copyReviews: defineTable({
    userId: v.id("users"),
    copyId: v.id("ownedPuzzles"),
    rating: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_copy", ["copyId"])
    .index("by_user_copy", ["userId", "copyId"]),

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
      v.literal("definition_disabled"),
      v.literal("definition_reenabled"),
      v.literal("definition_edited"),
      v.literal("proposal_approved"),
      v.literal("proposal_rejected"),
      v.literal("photo_restored"),
      v.literal("photo_removal_confirmed"),
      v.literal("photo_auto_rejected"),
      v.literal("photo_manually_approved"),
      v.literal("photo_manually_rejected"),
      v.literal("image_quarantined"),
      v.literal("csam_escalation_updated"),
      v.literal("role_granted"),
      v.literal("role_revoked"),
    ),
    targetLabel: v.string(), // denormalized display title at decision time
    targetId: v.string(),
    at: v.number(),
  })
    .index("by_at", ["at"])
    // Back the admin user-detail audit trail: actions a member PERFORMED as
    // admin, and actions TARGETING them (targetId = clerkId for role rows).
    // Additive — Convex indexes existing rows automatically, no backfill.
    .index("by_actor", ["actorId", "at"])
    .index("by_target", ["targetId", "at"]),

  // CSAM hash matches (lib/imageModeration/csamHashCheck), one row per quarantined image, for the
  // operator to report to Meldpunt Offlimits or the police (DSA Art. 18). Metadata only: the
  // image is never shown to anyone. `fileId` locates the PRESERVED blob for law enforcement; the
  // app never serves or deletes a blob referenced here (preservation is the operator's legal
  // call). `md5`/`sha1` are the matched hashes; `provider` the hash service that matched.
  csamEscalations: defineTable({
    table: v.union(
      v.literal("ownedPuzzleImages"),
      v.literal("completionImages"),
    ),
    rowId: v.string(),
    uploaderId: v.id("users"),
    // Who the uploader was AT MATCH TIME, so the report survives account deletion (the users
    // row is only tombstoned while an escalation is not closed; see users.deleteUser).
    uploaderSnapshot: v.optional(
      v.object({
        clerkId: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        username: v.optional(v.string()),
      }),
    ),
    // Absent only when a later re-check matched after the photo's blob was already gone.
    fileId: v.optional(v.id("_storage")),
    md5: v.string(),
    sha1: v.string(),
    provider: v.string(),
    // True when the match came from a later re-check of stored hashes, after the original upload
    // had already been replaced by its re-encode: `fileId` then holds the re-encode.
    originalDiscarded: v.optional(v.boolean()),
    matchedAt: v.number(),
    status: v.union(
      v.literal("open"),
      v.literal("reported"),
      v.literal("closed"),
    ),
    reportedAt: v.optional(v.number()),
    // Append-only operator notes (e.g. the report reference), each with its author and time.
    notes: v.optional(
      v.array(
        v.object({ at: v.number(), actorId: v.id("users"), text: v.string() }),
      ),
    ),
  })
    .index("by_status", ["status", "matchedAt"])
    .index("by_file", ["fileId"])
    .index("by_uploader", ["uploaderId"]),

  // Community change proposals against APPROVED catalog definitions. `changes` is the exact
  // patch the definition receives on approval; `baseline` snapshots the changed fields' values
  // at file/edit time so review UIs can derive "changed since proposed" markers (derived at
  // read time — never stored, never enforced). One PENDING proposal per (definition, proposer);
  // decided/withdrawn rows are kept as history. Domain-owned: `puzzleDefinitionId` and
  // `changes.category` are Catalog aggregate-id strings, `changes.image` a storage id string.
  puzzleChangeProposals: defineTable({
    aggregateId: v.string(), // ChangeProposalId
    puzzleDefinitionId: v.string(), // Catalog PuzzleDefinitionId (aggregate id, not puzzles._id)
    proposedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("withdrawn"),
    ),
    changes: proposalFields,
    baseline: proposalFields,
    comment: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_status", ["status"])
    .index("by_definition", ["puzzleDefinitionId"])
    .index("by_proposer", ["proposedBy", "status"]),

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

  // Exchange: per-trade owner reveal. One APPEND-ONLY row per exchange, written the first time the
  // OWNER (recipient) acts on it — accepts, or posts a member-authored message in its thread
  // (exchange/tradeRevealSubscriber). From then on the requester sees the owner's limited trade card
  // (name, handle, email, reviews received) INSIDE THIS TRADE ONLY; it never unlocks the owner's
  // profile elsewhere. The owner seeing the requester needs no row (derived: the requester asked).
  tradeReveals: defineTable({
    exchangeId: v.id("exchanges"),
    revealedAt: v.number(),
    reason: v.union(v.literal("accepted"), v.literal("owner_replied")),
  }).index("by_exchange", ["exchangeId"]),

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
    // DEPRECATED: read receipts now live on threadParticipants.lastReadAt. No longer written;
    // read only as the fallback until conversation/backfillParticipantState has run, then dropped.
    readReceipts: v.optional(
      v.array(v.object({ memberId: v.id("users"), lastReadAt: v.number() })),
    ),
    lastMessageAt: v.optional(v.number()), // denormalized for inbox ordering
    // Denormalized inbox summary of the newest message, written in the same transaction as its
    // insert. `body` is truncated (LAST_MESSAGE_BODY_MAX); for media rows it is the caption, and
    // blank for a media row without an attachment (legacy image rows). Never an attachment ref.
    // Absent on empty threads and on rows the backfill has not reached (the inbox then reads the
    // message).
    lastMessage: v.optional(
      v.object({
        messageId: v.string(),
        authorId: v.optional(v.id("users")),
        kind: v.union(
          v.literal("text"),
          v.literal("image"),
          v.literal("location"),
          v.literal("system"),
        ),
        body: v.string(),
        sentAt: v.number(),
        copyId: v.optional(v.id("ownedPuzzles")),
      }),
    ),
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
    kind: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("location"),
      v.literal("system"),
    ),
    // Text: the message. Media (image/location): the optional caption, "" allowed.
    body: v.string(),
    sentAt: v.number(),
    // The media message's attachment (the domain's opaque attachmentRef); absent on text/system
    // rows and on legacy image rows. A plain string until the attachments table lands, when it
    // becomes v.id("messageAttachments").
    attachmentId: v.optional(v.string()),
    // The copy this message is about, when sent from a copy's "Message" action. Lives on the
    // message (not the thread) because a DM is one long-lived thread per pair, spanning many
    // puzzles; absent on plain/system messages and every pre-existing row.
    copyId: v.optional(v.id("ownedPuzzles")),
    // Moderation tombstone (admin/decideReport, content_removed): the read models blank the body
    // and drop the copy card. The stored body stays for the report evidence trail.
    removedAt: v.optional(v.number()),
    removedReason: v.optional(v.string()),
  })
    .index("by_thread_sent", ["threadAggregateId", "sentAt"])
    // Copy-referencing messages of a thread, grouped per copy (rows without a copyId sort first
    // as undefined and are excluded by a range on copyId). Backs the inbox's context copies.
    .index("by_thread_copy_sent", ["threadAggregateId", "copyId", "sentAt"])
    .index("by_message_id", ["messageId"]),

  // Member-lookup projection of threads.participants, kept in sync by the repository on every
  // save (same pattern as circleMembers — Convex cannot index embedded arrays). Also the
  // per-member conversation state, so a read receipt patches only the reader's row. The state
  // fields are optional until conversation/backfillParticipantState has run; reads fall back.
  threadParticipants: defineTable({
    threadAggregateId: v.string(),
    memberId: v.id("users"),
    // The member's read receipt (moved off threads.readReceipts). Absent = never read.
    lastReadAt: v.optional(v.number()),
    // Unread messages for this member, capped at UNREAD_SCAN_CAP (50 = "50 or more").
    unreadCount: v.optional(v.number()),
    // The thread's lastMessageAt (createdAt while empty), copied for by_member_activity.
    lastActivityAt: v.optional(v.number()),
  })
    .index("by_member", ["memberId"])
    .index("by_thread", ["threadAggregateId"])
    .index("by_thread_member", ["threadAggregateId", "memberId"])
    .index("by_member_activity", ["memberId", "lastActivityAt"]),

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
      v.literal("proposal_approved"),
      v.literal("proposal_rejected"),
      v.literal("admin_proposal_filed"),
      v.literal("admin_definition_submitted"),
      v.literal("new_follower"),
      v.literal("follow_request_received"),
      v.literal("follow_request_approved"),
      v.literal("household_invite_received"),
      v.literal("household_invite_accepted"),
      v.literal("connection_offer_received"),
      v.literal("whats_new"),
    ),
    // Legacy pre-rendered English copy. Optional since notifications went structured: new rows
    // store `params` and the edges render copy (web via i18n keys, email via @jigswap/email).
    title: v.optional(v.string()),
    message: v.optional(v.string()),
    // Render-ready values for the type's copy (e.g. actorName, puzzleTitle). Flat string map;
    // the per-type key contract lives with the subscriber (notifications/copy.ts documents it).
    params: v.optional(v.record(v.string(), v.string())),
    relatedId: v.optional(v.string()), // ID of related entity (trade, puzzle, etc.)
    // Delivery channel. Optional so legacy rows validate; defaults to "inApp" (backfill stamps it).
    channel: v.optional(v.string()),
    isRead: v.boolean(),
    createdAt: v.number(),
    // Structured references the read side resolves live (names, avatars, status), so the row never
    // has to snapshot them. All optional: legacy rows carry none. `actorIds` is newest first;
    // `actorCount` is the total distinct actors (>= actorIds.length once rows are grouped).
    actorIds: v.optional(v.array(v.id("users"))),
    actorCount: v.optional(v.number()),
    // What the notification is about (mirrors the domain NotificationSubject). Exchange, thread,
    // follow request, invite, household, review, proposal, whats-new and connection-offer ids are
    // opaque aggregate
    // ids; puzzle/copy/goal are the Convex `_id`s every producer already holds.
    subject: v.optional(
      v.union(
        v.object({ kind: v.literal("exchange"), exchangeId: v.string() }),
        v.object({ kind: v.literal("thread"), threadId: v.string() }),
        v.object({ kind: v.literal("followRequest"), requestId: v.string() }),
        v.object({ kind: v.literal("householdInvite"), inviteId: v.string() }),
        v.object({ kind: v.literal("household"), householdId: v.string() }),
        v.object({ kind: v.literal("puzzle"), puzzleId: v.id("puzzles") }),
        v.object({ kind: v.literal("copy"), copyId: v.id("ownedPuzzles") }),
        v.object({ kind: v.literal("goal"), goalId: v.id("goals") }),
        v.object({ kind: v.literal("review"), reviewId: v.string() }),
        v.object({
          kind: v.literal("changeProposal"),
          proposalId: v.string(),
        }),
        v.object({ kind: v.literal("whatsNew"), entryId: v.string() }),
        v.object({ kind: v.literal("connectionOffer"), offerId: v.string() }),
      ),
    ),
    // Grouping (write-time merge of e.g. new_follower rows): the group a row belongs to and the
    // last time it absorbed an actor. Absent = never grouped.
    groupKey: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "isRead"])
    .index("by_user_group", ["userId", "groupKey", "isRead"])
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
    // Friend-facing in-progress sharing. undefined = never chosen; every gate tests `=== true`.
    shareInProgress: v.optional(v.boolean()),
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
    // Member-chosen display name. Optional: profiles opened lazily (visibility toggle / shelf
    // curation) carry none, and readers fall back to the live account name.
    displayName: v.optional(v.string()),
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
  // puzzle). A lightweight, append-only post: trimmed text + author + when.
  // aggregateId is the CommentId; `by_puzzle` backs the newest-first read keyed on puzzleId.
  puzzleComments: defineTable({
    aggregateId: v.optional(v.string()),
    puzzleId: v.id("puzzles"),
    // Set only for COPY-scoped comments (the owner's notes on one owned copy). Absent rows
    // are community reviews of the shared puzzle definition. Copy-scoped rows are listed by_copy and
    // excluded from the definition's community reviews.
    copyId: v.optional(v.id("ownedPuzzles")),
    authorId: v.id("users"),
    text: v.string(),
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

  // Social: a member's shareable invite link. One ACTIVE row per member (revokedAt undefined);
  // resets revoke the old row and insert a new one so historical counters survive. The token rides
  // on the profile URL as ?invite=<token> (QR + share). Counters are the growth-loop metrics.
  inviteLinks: defineTable({
    ownerId: v.id("users"),
    token: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    landingViews: v.number(),
    signupsAttributed: v.number(),
    followsEstablished: v.number(),
    // Absent = the member's network link (the one ACTIVE row above). Present = a household
    // invite link: minted by the household admin, single-use, expiring. Never stores a recipient.
    context: v.optional(
      v.object({ kind: v.literal("household"), householdId: v.string() }),
    ),
    expiresAt: v.optional(v.number()), // household links only: createdAt + 14 d
    consumedAt: v.optional(v.number()), // household links are single-use
    consumedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_token", ["token"]),

  // Social: one row per redeemed invite — makes redeemInvite idempotent per new member
  // (by_new_member is checked before establishing the mutual follow).
  inviteRedemptions: defineTable({
    inviteLinkId: v.id("inviteLinks"),
    inviterId: v.id("users"),
    newMemberId: v.id("users"),
    createdAt: v.number(),
  }).index("by_new_member", ["newMemberId"]),

  // Social: confirm-first connection offers (ConnectionOffer aggregate). Redeeming an invite link
  // at sign-up offers the new member (toId) a mutual follow with the link's owner (fromId); nothing
  // is followed until they accept. inviteLinkId attributes an accept to the link's
  // followsEstablished. At most one pending row per ordered pair (by_from_to_status); expiry is
  // lazy (reads check expiresAt) plus a scheduled expire at expiresAt.
  connectionOffers: defineTable({
    aggregateId: v.string(),
    fromId: v.id("users"),
    toId: v.id("users"),
    source: v.union(v.literal("inviteLink"), v.literal("householdLink")),
    inviteLinkId: v.optional(v.id("inviteLinks")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_from_to_status", ["fromId", "toId", "status"])
    .index("by_to_status", ["toId", "status"]),

  // FollowRequest aggregate rows: a member asking to follow a private-profile member.
  // status pending → approved | declined; respondedAt backs the 7-day decline cooldown.
  // Declined rows are kept (not deleted) so a re-request inside the cooldown can be
  // silently swallowed — deleting them would make a decline observable. cancelledAt is
  // stamped when the requester cancels a declined-in-cooldown request: the row is retained
  // (never destroying the cooldown record) but stops masking as pending on the read side; a
  // re-request within the cooldown clears it and silently resumes the mask.
  followRequests: defineTable({
    aggregateId: v.string(),
    requesterId: v.id("users"),
    targetId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    // Set when a token flow (QR scan / invite redemption) auto-approved this request instead of
    // the target clicking "approve". The Notifications subscriber reads it so its post-approval
    // suppression does NOT eat the target's new_follower — in a token flow the target never
    // approved, so they still deserve to learn they gained a follower (S1).
    approvedViaToken: v.optional(v.boolean()),
  })
    .index("by_requester", ["requesterId"])
    .index("by_target", ["targetId"])
    .index("by_target_status", ["targetId", "status"])
    .index("by_requester_target", ["requesterId", "targetId"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Social: member blocks (spec 2.6). Silent and two-way in effect: a row means `blockerId`
  // blocked `blockedId`, and every gate checks both directions (social/blocks.ts). The list is the
  // blocker's personal data and is never exposed to the blocked member. Deleted on unblock.
  blocks: defineTable({
    blockerId: v.id("users"),
    blockedId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_blocker", ["blockerId"])
    .index("by_blocked", ["blockedId"])
    .index("by_pair", ["blockerId", "blockedId"]),

  // Household context: members who pool their libraries (copies stay owned by whoever added them;
  // household visibility/management is derived from membership at read time). A member belongs to
  // at most one household — enforced by the use cases via `householdMembers.by_member`.
  households: defineTable({
    aggregateId: v.string(), // HouseholdId
    createdAt: v.number(),
    // Household-wide permission for member copies without an explicit householdPermission.
    // Absent = "manage" (no backfill). Resolved at read time by the domain helper.
    defaultCopyPermission: v.optional(
      v.union(v.literal("manage"), v.literal("view")),
    ),
  }).index("by_aggregate_id", ["aggregateId"]),

  householdMembers: defineTable({
    householdId: v.string(), // HouseholdId (households.aggregateId)
    memberId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_household", ["householdId"]),

  householdInvites: defineTable({
    aggregateId: v.string(), // HouseholdInviteId
    householdId: v.string(), // HouseholdId
    inviterId: v.id("users"),
    inviteeId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_invitee_status", ["inviteeId", "status"])
    .index("by_household", ["householdId"]),

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
    // Dispatch bookkeeping, written only once a subscriber has failed (a clean dispatch stamps
    // processedAt alone). attempts = dispatch passes run; completedHandlers are skipped on retry;
    // failedHandlers gave up (non-idempotent, blocked by a failed dependency, or out of retries).
    // failedAt marks the event terminally failed — it needs an operator, never auto-retries.
    attempts: v.optional(v.number()),
    completedHandlers: v.optional(v.array(v.string())),
    failedHandlers: v.optional(v.array(v.string())),
    lastError: v.optional(
      v.object({ handler: v.string(), message: v.string() }),
    ),
    failedAt: v.optional(v.number()),
  })
    .index("by_processed", ["processedAt"])
    .index("by_failed", ["failedAt"])
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

  // What's new read state: one row per member that has marked an entry seen. `seenEntryIds` holds
  // manifest ids only (@jigswap/contracts WHATS_NEW_MANIFEST) and is pruned of ids that left the
  // manifest on every write. Entries published before the account existed are read by definition
  // and never stored. The highlight modal derives from this set (no separate "modal shown" state).
  whatsNewReadStates: defineTable({
    memberId: v.id("users"),
    seenEntryIds: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // One row per (member, tour) the member has started from a What's new entry. `step` is the
  // 0-based step to resume from (in_progress) or the last step reached.
  whatsNewTourProgress: defineTable({
    memberId: v.id("users"),
    tourId: v.string(),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("dismissed"),
    ),
    step: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_member_tour", ["memberId", "tourId"]),

  // Quick start (onboarding): at most one row per member, created lazily by the first
  // onboarding/recordQuickStart write; no row means nothing skipped or dismissed. Only the member's
  // choices are stored: step "done" is never stored, it is derived from real data (getQuickStart).
  memberOnboarding: defineTable({
    memberId: v.id("users"),
    // Steps the member chose to skip, in step order.
    skippedSteps: v.array(
      v.union(
        v.literal("puzzles"),
        v.literal("solves"),
        v.literal("people"),
        v.literal("household"),
        v.literal("profile"),
      ),
    ),
    welcomeDismissedAt: v.optional(v.number()),
    cardDismissedAt: v.optional(v.number()),
    // When the member first opened the /welcome flow (a funnel fact for the activation report).
    startedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // One row per notify:true What's new entry whose whats_new notification fan-out has started
  // (whatsNew/publishPending). The row is the idempotency key: an entry with a row is never fanned
  // out again. `completedAt` is set when the last member batch has run.
  whatsNewPublications: defineTable({
    entryId: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_entry", ["entryId"]),

  // Fixed-window rate limit counters (lib/rateLimits). One row per key ("<limit>:<memberId>"),
  // reset in place when its window has passed, so the table stays bounded without a cleanup job.
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});
