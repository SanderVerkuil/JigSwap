import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { hashCheckFields } from "./lib/imageModeration/hashCheckFields";

// A circle thread's join/leave fact (threadMessages.systemEvent and its lastMessage summary).
// There is deliberately no "removed" kind and no remover: removal and leaving render alike.
const systemEventValidator = v.object({
  kind: v.union(v.literal("joined"), v.literal("left")),
  memberId: v.id("users"),
});

// An exchange thread's trade lifecycle fact (threadMessages.tradeEvent and its lastMessage summary),
// rendered in the reader's language. Rows written before it existed carry only an English body;
// the read models map those (conversation/readModelHelpers tradeEventOf).
const tradeEventValidator = v.object({
  kind: v.union(
    v.literal("proposed"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("cancelled"),
    v.literal("completed"),
    v.literal("cancelled_member_deleted"),
  ),
});

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

// One stored rendition of an image (imageRenditions): its blob and its size in px.
const renditionSlotValidator = v.object({
  fileId: v.id("_storage"),
  width: v.number(),
  height: v.number(),
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
    // (users.updateOrCreateUser) and the daily backfillUserRoles reconcile. DISPLAY +
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
    // Clerk's `updated_at` of the newest user event applied to this row (users.updateOrCreateUser).
    // Webhooks arrive in no guaranteed order, so an event older than this is dropped. Separate
    // from `updatedAt`, which local profile edits also bump. Absent on rows synced before ordering
    // was tracked: the next event is then accepted.
    clerkUpdatedAt: v.optional(v.number()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_username", ["username"])
    .index("by_slug", ["slug"])
    .index("by_role", ["role"])
    .searchIndex("by_searchable_name", {
      searchField: "searchableName",
    }),

  // Clerk accounts that were deleted (users.deleteUser), so a late or redelivered Clerk webhook
  // can't recreate them (users.updateOrCreateUser). Holds a one-way SHA-256 fingerprint of the
  // Clerk user id, never the id itself, and nothing else about the member. Clerk never reuses an
  // id, so a member who signs up again gets a new account and is unaffected.
  deletedClerkUsers: defineTable({
    fingerprint: v.string(),
    deletedAt: v.number(),
  }).index("by_fingerprint", ["fingerprint"]),

  // Box art that went through the server's checks (catalog/boxArtUploads): the blob and the
  // member it was checked for. A definition or proposal only takes a NEW image that is listed
  // here for the acting member, so no box art is stored with its EXIF/GPS.
  boxArtUploads: defineTable({
    storageId: v.id("_storage"),
    uploaderId: v.id("users"),
    // The image-table lifecycle of the shared moderation pipeline (lib/imageModeration), as on
    // ownedPuzzleImages. ABSENT on rows listed before box art was moderated: served as before.
    // Box art is served to anyone only once "approved" with its hash check passed (boxArtUrl).
    moderationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("unscored"),
        // A CSAM hash-list match: never served to anyone; the blob is preserved.
        v.literal("quarantined"),
      ),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
    // When the pipeline swapped the row to its re-encoded blob (absent = still the upload).
    reencodedAt: v.optional(v.number()),
    // The admin who decided it by hand (admin/decideUncheckedPhoto); a manual decision is final.
    moderatedBy: v.optional(v.id("users")),
    // When an admin last sent it back to "pending" (admin/recheckPhoto). The stalled-check sweep
    // (lib/imageModeration/stalledSweep) counts from here, else from createdAt.
    recheckedAt: v.optional(v.number()),
    // CSAM hash-check bookkeeping + publication gate (lib/imageModeration/hashCheckFields).
    ...hashCheckFields,
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_moderation_status", ["moderationStatus"])
    // The uploader's own box art still being checked (catalog/boxArtInCheck).
    .index("by_uploader_status", ["uploaderId", "moderationStatus"])
    // ... and its own box art waiting on its hash check, read per uploader so other members'
    // waiting rows are never scanned (catalog/boxArtInCheck).
    .index("by_uploader_hash_pending", ["uploaderId", "hashCheckPendingSince"])
    .index("by_hash_check_pending", ["hashCheckPendingSince"])
    // Timed-out hash checks still closed (admin/listUncheckedPhotos): hashCheckedAt undefined.
    .index("by_hash_check_timed_out", ["hashCheckedAt", "hashCheckTimedOutAt"])
    // Published without a hash check, none configured (admin/listCsamEscalations counts them).
    .index("by_hash_check_skipped", ["hashCheckSkippedAt"]),

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
    // Barcode lookups always ask for a status: the scan/import match wants the approved row and
    // the uniqueness rule only the statuses that hold a barcode (a rejected row releases it).
    .index("by_ean_status", ["ean", "status"])
    .index("by_upc_status", ["upc", "status"])
    // Whether a blob is a puzzle's box art (message-photo claims refuse it).
    .index("by_image", ["image"])
    .index("by_aggregate_id", ["aggregateId"])
    // Lets a contributor list their own submissions (e.g. own not-yet-approved puzzles).
    .index("by_submitted_by", ["submittedBy"])
    // Catalog lists read by status (the approved catalogue, the pending queue) through these
    // instead of scanning the table; the implicit _creationTime suffix keeps newest-first order.
    // by_status is also the bounded pending-submissions count (admin/getPendingCounts).
    .index("by_status", ["status"])
    .index("by_status_brand", ["status", "brand"])
    // The public catalog's piece range (catalog/browsePublicCatalog): an anonymous read must not
    // walk the approved catalogue to find what a range holds.
    .index("by_status_pieces", ["status", "pieceCount"])
    // The public facet reads (catalog/getAll*) distinct over these from the approved rows only, so
    // pending and rejected submissions cost them no reads, however many arrive (SEC-26).
    .index("by_status_publisher", ["status", "publisher"])
    .index("by_status_series", ["status", "series"])
    .index("by_status_tags", ["status", "tags"])
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
    // Denormalized listing flag: true iff at least one availability flag above is set
    // (library/openListing.isOpenAvailability). Every availability write keeps it in step: the copy
    // repository's mapper on every save, and exchange's markCopyUnavailable. It lets Browse read open
    // copies from `by_listing` / `by_puzzle_listing` without scanning closed ones. Absent on rows written
    // before it existed until library/backfillCopyOpenFlag has run, so a reader must decide a row
    // without it from `availability`.
    isOpen: v.optional(v.boolean()),
    // Denormalized listing state for Browse's candidate index (`by_listing` / `by_puzzle_listing`),
    // written by the copy repository on every save, by markCopyUnavailable, by the owner's profile
    // visibility sync (library/ownerListingVisibility) and by library/backfillCopyOpenFlag:
    //   ownerPrivate  true while the owner's profile is private; absent means public, as on
    //                 `profiles`. Browse shows a private owner's copy only through a circle, which it
    //                 reads separately, so those rows stay out of its public range and can't use up
    //                 a page's read budget.
    //   listedAt      when the copy was last offered (became open); kept while it is closed, so that
    //                 reopening soon after keeps its place. Browse lists the newest offers first, so
    //                 an old copy offered today sorts as new.
    // A reader still re-checks the owner's visibility: a lagging flag can cost a slot, never leak.
    ownerPrivate: v.optional(v.literal(true)),
    listedAt: v.optional(v.number()),
    // The SharingSetting's visibility axis: the OWNER'S CHOICE of who can see the copy, orthogonal
    // to the availability flags (what it can be USED for). It stays "private" while a private copy
    // is offered (the offer makes it visible only while it lasts), so withdrawing restores it.
    // Optional; legacy rows are unset. Convex has no column defaults: the "visible" default lives in
    // the create paths (domain SharingSetting.newCopy) and in library/copyVisibility. NEVER read
    // this column directly to decide who may see a copy — always go through effectiveCopyVisibility.
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
    .index("by_aggregate_id", ["aggregateId"])
    // The candidate sources of Browse and the definition view (library/openListing): open copies,
    // by owner visibility, newest offer first, platform-wide or for one definition.
    .index("by_listing", ["isOpen", "ownerPrivate", "listedAt"])
    .index("by_puzzle_listing", [
      "puzzleId",
      "isOpen",
      "ownerPrivate",
      "listedAt",
    ])
    // One member's copies of one definition (the definition view's household owner count and
    // "you own this"), by either link a copy has to it.
    .index("by_owner_puzzle", ["ownerId", "puzzleId"])
    .index("by_owner_definition", ["ownerId", "puzzleDefinitionId"]),

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
    // When the moderation pipeline swapped the row to its re-encoded (EXIF/GPS-stripped) blob (or,
    // before every WebP was re-encoded, to a WebP's stripped bytes). Absent = the stored blob is
    // still the upload as sent; the pipeline re-encodes on any attempt until this is set.
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
    .index("by_hash_check_pending", ["hashCheckPendingSince"])
    // Timed-out hash checks still closed (admin/listUncheckedPhotos): hashCheckedAt undefined.
    .index("by_hash_check_timed_out", ["hashCheckedAt", "hashCheckTimedOutAt"])
    // Published without a hash check, none configured (admin/listCsamEscalations counts them).
    .index("by_hash_check_skipped", ["hashCheckSkippedAt"])
    // Whether a blob is already a copy photo (message-photo claims refuse it).
    .index("by_file", ["fileId"])
    // Account deletion: the photos a member uploaded (conversation/purgeMemberMessagingData).
    .index("by_uploader", ["uploaderId"]),

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
    .index("by_aggregate_id", ["aggregateId"]),

  // Collection membership - many-to-many relationship (now references ownedPuzzles)
  collectionMembers: defineTable({
    collectionId: v.id("collections"),
    ownedPuzzleId: v.id("ownedPuzzles"),
    addedAt: v.number(),
  })
    .index("by_collection", ["collectionId"])
    .index("by_owned_puzzle", ["ownedPuzzleId"]),

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
    // When the moderation pipeline swapped the row to its re-encoded (EXIF/GPS-stripped) blob (or,
    // before every WebP was re-encoded, to a WebP's stripped bytes). Absent = the stored blob is
    // still the upload as sent; the pipeline re-encodes on any attempt until this is set.
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
    .index("by_hash_check_pending", ["hashCheckPendingSince"])
    // Timed-out hash checks still closed (admin/listUncheckedPhotos): hashCheckedAt undefined.
    .index("by_hash_check_timed_out", ["hashCheckedAt", "hashCheckTimedOutAt"])
    // Published without a hash check, none configured (admin/listCsamEscalations counts them).
    .index("by_hash_check_skipped", ["hashCheckSkippedAt"])
    // Whether a blob is already a completion photo (message-photo claims refuse it).
    .index("by_file", ["fileId"]),

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
    // Most recently updated first, for the review lists' pages. `updatedAt` is required, so this
    // needs no backfill.
    .index("by_puzzle_updated", ["puzzleId", "updatedAt"])
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
      v.literal("photo_hash_check_waived"),
      v.literal("image_quarantined"),
      v.literal("csam_escalation_updated"),
      v.literal("role_granted"),
      v.literal("role_revoked"),
      v.literal("report_dismissed"),
      v.literal("report_content_removed"),
      v.literal("report_warned"),
      v.literal("message_image_auto_rejected"),
      v.literal("message_image_restored"),
      // Admin writes outside the moderation queues (review 2026-10-29, SEC-56). None feeds a
      // KPI (admin/getModerationStats). Labels never carry a member's personal data.
      v.literal("photo_recheck_requested"),
      v.literal("category_created"),
      v.literal("category_updated"),
      v.literal("category_deactivated"),
      v.literal("category_reactivated"),
      v.literal("categories_reordered"),
      v.literal("contact_message_handled"),
      v.literal("contact_message_reopened"),
    ),
    targetLabel: v.string(), // denormalized display title at decision time
    targetId: v.string(),
    // The member a role change or report decision targets (SEC-57). Such a row stores this id
    // and a neutral targetLabel, never the member's name or email: the admin read models
    // resolve the label while the account exists and read "Deleted member" once it is gone.
    // Absent on rows about content, and on rows stamped before it
    // (admin/backfillAuditTargets).
    targetMemberId: v.optional(v.id("users")),
    at: v.number(),
  })
    .index("by_at", ["at"])
    // Back the admin user-detail audit trail: actions a member PERFORMED as
    // admin, and actions TARGETING them (by_target_member; legacy role rows
    // key targetId on the clerkId until the backfill has run).
    // Additive — Convex indexes existing rows automatically, no backfill.
    .index("by_actor", ["actorId", "at"])
    .index("by_target", ["targetId", "at"])
    .index("by_target_member", ["targetMemberId", "at"])
    // The console's activity log filtered to one kind, newest first (admin/getModerationActivity).
    // Additive, on existing fields: Convex indexes existing rows automatically, no backfill.
    .index("by_kind", ["kind", "at"]),

  // CSAM hash matches (lib/imageModeration/csamHashCheck), one row per quarantined image, for the
  // operator to report to Meldpunt Offlimits or the police (DSA Art. 18). Metadata only: the
  // image is never shown to anyone. `fileId` locates the PRESERVED blob for law enforcement; the
  // app never serves or deletes a blob referenced here (preservation is the operator's legal
  // call). `md5`/`sha1` are the matched hashes; `provider` the hash service that matched.
  csamEscalations: defineTable({
    table: v.union(
      v.literal("ownedPuzzleImages"),
      v.literal("completionImages"),
      v.literal("messageAttachments"),
      v.literal("boxArtUploads"),
      v.literal("circleIcons"),
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

  // Smaller WebP copies of a served image blob (lib/imageModeration/renditions) for the places
  // that show it small (cards, thumbnails). One row per SOURCE blob, made once the image may be
  // shown (renditionsStore.renditionKindOf); `width`/`height` are the source's. Each slot is
  // its rung's width, or the source's own width in the first rung the source does not exceed
  // (the later slots then stay empty); a slot is also absent when its WebP came out not clearly
  // smaller than the source (renditionEncode). An image only ever shown small (a completion photo,
  // a circle icon) has `small` alone, at 256 px. A message photo has no row here: its one thumbnail
  // lives on its own row (messageAttachments.thumbFileId). A row with no slot means "nothing smaller to
  // offer". Every slot blob counts as referenced (blobReferences), and the row and its blobs are
  // deleted with the source (renditionsStore.deleteRenditions). Read models serve them only
  // through the source's own publication gate, and only as URLs.
  imageRenditions: defineTable({
    sourceId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    small: v.optional(renditionSlotValidator), // 480 px wide, or 256 (or the source's width)
    medium: v.optional(renditionSlotValidator), // 640 px wide (or the source's width)
    large: v.optional(renditionSlotValidator), // 960 px wide (or the source's width)
    createdAt: v.number(),
  })
    .index("by_source", ["sourceId"])
    .index("by_small_file", ["small.fileId"])
    .index("by_medium_file", ["medium.fileId"])
    .index("by_large_file", ["large.fileId"]),

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
    .index("by_proposer", ["proposedBy", "status"])
    // Whether a blob is a proposed box art (message-photo claims refuse it).
    .index("by_changes_image", ["changes.image"]),

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
    // The first calendar day (UTC midnight) the goal counts solves on. Optional: goals without it
    // (every goal set before periods existed) count from the UTC day of `createdAt`.
    startDate: v.optional(v.number()),
    // The last calendar day (UTC midnight) the goal counts solves on, inclusive.
    targetDate: v.optional(v.number()),
    // When GoalAchieved went out for the current target, so it goes out at most once. Optional: a
    // goal without it hasn't announced anything the domain knows of.
    achievementAnnouncedAt: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
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
    // Trade only: who owned the offered puzzle when it was offered (the initiator, or the household
    // mate whose copy they co-manage), set by propose. Accept and completion refuse once the offered
    // copy has another owner. Absent on older rows, which fall back to the live offer rule. No
    // backfill, no index. Internal: never part of an exchange view or export (a mate is no party).
    offeredPuzzleOwnerId: v.optional(v.id("users")),
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

    // What made the initiator eligible to ask, set by propose: "direct" (a route through the owner:
    // public profile, household, mutual follow) or "circle" (only their own Exchange/Admin circle
    // seats). Accept re-checks the circle standing only for "circle". Absent on older rows, where
    // accept falls back to the live routes. No backfill.
    eligibleVia: v.optional(v.union(v.literal("direct"), v.literal("circle"))),

    // --- Timestamps ---
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_initiator", ["initiatorId", "offeredPuzzleId"])
    .index("by_recipient", ["recipientId", "offeredPuzzleId"])
    // Newest-first per party for the bounded member list (exchange/getUserExchanges): the two
    // indexes above order by offeredPuzzleId, so they cannot pick a member's newest exchanges.
    .index("by_initiator_created", ["initiatorId", "createdAt"])
    .index("by_recipient_created", ["recipientId", "createdAt"])
    // Most recent activity first per party, for the finished exchanges' pages
    // (exchange/listMyExchangeHistory). `updatedAt` is required, so these need no backfill.
    .index("by_initiator_updated", ["initiatorId", "updatedAt"])
    .index("by_recipient_updated", ["recipientId", "updatedAt"])
    // Per party and status, newest first: the bounded lists read the live statuses here, so an old
    // open exchange is never cut off by the newest-history window (exchange/readViews,
    // readMemberExchanges).
    .index("by_initiator_status_created", [
      "initiatorId",
      "status",
      "createdAt",
    ])
    .index("by_recipient_status_created", [
      "recipientId",
      "status",
      "createdAt",
    ])
    .index("by_aggregate_id", ["aggregateId"])
    // Back the copy-reservation check: find exchanges referencing a copy as requested/offered
    // without scanning the whole table.
    .index("by_requested_copy", ["requestedPuzzleId"])
    .index("by_offered_copy", ["offeredPuzzleId"]),

  // Exchange: per-trade owner reveal. One APPEND-ONLY row per exchange, written the first time the
  // OWNER (recipient) acts on it — accepts, or posts a member-authored message in its thread
  // (exchange/tradeRevealSubscriber). From then on the requester sees the owner's limited trade card
  // (name, handle, reviews received) INSIDE THIS TRADE ONLY; it never unlocks the owner's
  // profile elsewhere. The owner seeing the requester needs no row (derived: the requester asked).
  // A reveal never includes the email: that takes a tradeContactShares row (below).
  tradeReveals: defineTable({
    exchangeId: v.id("exchanges"),
    revealedAt: v.number(),
    reason: v.union(v.literal("accepted"), v.literal("owner_replied")),
  }).index("by_exchange", ["exchangeId"]),

  // Exchange: one party's explicit consent to show their email to the other party of THIS trade
  // (exchange/setContactSharing; read by exchange/getTradePartner through the domain rule
  // tradeEmailVisible). At most one row per side; deleting it withdraws consent. No row = not
  // shared (fail closed, no backfill). Holds no member id: the side resolves through the exchange,
  // which is how the account purge (conversation/purgeMemberMessagingData) and the data export
  // (insights/exportUserDataPage) find it.
  tradeContactShares: defineTable({
    exchangeId: v.id("exchanges"),
    side: v.union(v.literal("initiator"), v.literal("recipient")),
    sharedAt: v.number(),
  }).index("by_exchange_side", ["exchangeId", "side"]),

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
    .index("by_receiver", ["receiverId"]),

  // Conversation context. One row per Thread aggregate; messages are companion rows (long chats
  // must not brush the document size limit). participantsKey = the two user _ids sorted and
  // joined with "|" for exchange/DM pairs — this backs both the one-DM-per-pair rule and the
  // ConnectionPolicy's "existing thread between the pair" check. A circle thread (one per friend
  // circle, participants = its members, at most 50) keys as `circle:<circleId>` instead, so it
  // never matches a pair key.
  threads: defineTable({
    aggregateId: v.string(),
    subjectKind: v.union(
      v.literal("exchange"),
      v.literal("dm"),
      v.literal("circle"),
    ),
    exchangeId: v.optional(v.id("exchanges")), // set iff subjectKind === "exchange"
    circleId: v.optional(v.string()), // the CircleId aggregateId, set iff subjectKind === "circle"
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
        // Set when a moderator removed this message (body then empty, no copyId).
        removed: v.optional(v.literal(true)),
        // A circle thread's join/leave row: who joined or left (rendered per viewer).
        systemEvent: v.optional(systemEventValidator),
        // An exchange thread's lifecycle row: which trade step it records.
        tradeEvent: v.optional(tradeEventValidator),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_exchange", ["exchangeId"])
    .index("by_circle", ["circleId"])
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
    // The media message's attachment row (the domain's opaque attachmentRef); absent on
    // text/system rows and on legacy image rows. Written only by the deferred append
    // (conversation/messageAttachments.ts) once the attachment is deliverable.
    attachmentId: v.optional(v.id("messageAttachments")),
    // The copy this message is about, when sent from a copy's "Message" action. Lives on the
    // message (not the thread) because a DM is one long-lived thread per pair, spanning many
    // puzzles; absent on plain/system messages and every pre-existing row.
    copyId: v.optional(v.id("ownedPuzzles")),
    // Moderation tombstone (admin/decideReport, content_removed): the read models blank the body
    // and drop the copy card. The stored body stays for the report evidence trail.
    removedAt: v.optional(v.number()),
    removedReason: v.optional(v.string()),
    // A circle thread's join/leave system row: the member who joined or left (leaving and removal
    // alike; the remover is never stored). Each viewer's read projects the member through their
    // own identity rules, so no name is snapshotted. Absent on every other message.
    systemEvent: v.optional(systemEventValidator),
    // An exchange thread's lifecycle row (proposed, accepted, …): the step, rendered in each
    // reader's language. Absent on every other message and on rows written before it existed.
    tradeEvent: v.optional(tradeEventValidator),
  })
    .index("by_thread_sent", ["threadAggregateId", "sentAt"])
    // Copy-referencing messages of a thread, grouped per copy (rows without a copyId sort first
    // as undefined and are excluded by a range on copyId). Backs the inbox's context copies.
    .index("by_thread_copy_sent", ["threadAggregateId", "copyId", "sentAt"])
    .index("by_message_id", ["messageId"])
    // The messages one member wrote, for their data export (insights/exportUserDataPage).
    .index("by_author", ["authorId", "sentAt"]),

  // A message's attachment (spec 2.1/2.2), staged BEFORE its message exists: the uploader stages
  // a photo (conversation/stageMessageImage), the shared image pipeline screens it
  // (conversation/attachmentModerationStore), and the thread message is appended only once it is
  // deliverable AND its send was requested (deferred append, conversation/messageAttachments.ts).
  // Until then nothing about it reaches the other participant: no message, no lastMessage, no
  // unread, no notification. Moderation state lives here, never in the append-only history.
  // Discriminated on `kind`: "image" (a screened photo) or "location" (a shared place with its
  // server-rendered map preview; conversation/sendLocation, no screening).
  messageAttachments: defineTable(
    v.union(
      v.object({
        kind: v.literal("image"),
        threadAggregateId: v.string(),
        uploaderId: v.id("users"),
        fileId: v.id("_storage"),
        // One 640 px WebP of the clean image (or at its own width when narrower), made in the
        // background once the photo is servable (lib/imageModeration/renditionsStore), and served
        // only where the photo is (messageAttachmentViews). Deleted with the photo's blobs
        // (deleteAttachmentBlobs), and at once on a CSAM match.
        thumbFileId: v.optional(v.id("_storage")),
        // When the thumbnail job finished: with no thumbFileId, no WebP came out clearly smaller,
        // so it is not decoded again.
        thumbCheckedAt: v.optional(v.number()),
        // Pixel size the client reported at staging (layout only: the aspect-ratio box).
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        byteSize: v.number(),
        contentType: v.string(),
        // The image-table lifecycle (incl. "unscored" and "quarantined"), plus:
        // - "blurred": scored in the sensitive band (MESSAGE_IMAGE_BLUR_THRESHOLD up to the reject
        //   threshold); delivered blurred with "Show". (A non-mutual sender's image is ALSO shown
        //   blurred, but that is decided per viewer at read time, never stored.)
        // - "removed": a moderator removed it after a report; its message is tombstoned.
        // "unscored" (the classifier stayed unavailable through the retries) is delivered blurred
        // and labelled "not checked"; it is never silently approved.
        moderationStatus: v.union(
          v.literal("pending"),
          v.literal("approved"),
          v.literal("blurred"),
          v.literal("unscored"),
          v.literal("rejected"),
          v.literal("quarantined"),
          v.literal("removed"),
        ),
        moderationScore: v.optional(v.number()),
        moderationLabel: v.optional(v.string()),
        moderationReason: v.optional(v.string()),
        moderationAttempts: v.optional(v.number()),
        // Blurhash (lib/blurhash) of the clean image, from the pipeline's re-encode. Kept on removal
        // so a removed photo can keep a placeholder; never exposed for a rejected/quarantined row.
        blurhash: v.optional(v.string()),
        // When the pipeline swapped the row to its re-encoded (EXIF/GPS-stripped) blob. Absent = still
        // the upload as sent: the pipeline re-encodes on any attempt until it is set, and the photo is
        // never delivered before it is.
        reencodedAt: v.optional(v.number()),
        // CSAM hash-check bookkeeping + publication gate (lib/imageModeration/hashCheckFields).
        ...hashCheckFields,
        // Set by sendStagedImages: the batch's request time (shared by up to 4 photos) and each
        // photo's position in it; delivery is in this order. The caption rides on the batch's LAST
        // photo.
        sendRequestedAt: v.optional(v.number()),
        sendIndex: v.optional(v.number()),
        caption: v.optional(v.string()),
        // The appended thread message (absent = not delivered). Set once, by the first appender.
        messageId: v.optional(v.string()),
        // An open report references it: its blobs are never deleted by expiry or removal.
        evidenceHold: v.optional(v.boolean()),
        // The sender was told their photo was not sent (message_image_rejected), once; rejected and
        // quarantined photos get the same notice.
        rejectionNotifiedAt: v.optional(v.number()),
        // "Ask for a review" (spec R.10): only then may an admin see an auto-rejected photo.
        reviewRequestedAt: v.optional(v.number()),
        reviewDecidedAt: v.optional(v.number()),
        // A quarantined photo's review request "ends" for the sender like an upheld one (sender view
        // only; no admin ever sees or decides it): set by a flip 24 h - 7 d after the request.
        senderReviewUpheldAt: v.optional(v.number()),
        // The admin who restored or upheld it on review.
        moderatedBy: v.optional(v.id("users")),
        // A quarantined photo at a point where a rejected one would be deleted (purge, block): kept
        // whole for the CSAM preservation, but gone for its sender just the same (every sender-facing
        // read and mutation treats it as not found).
        hiddenFromSender: v.optional(v.boolean()),
        // Why a "removed" photo is gone when no moderator removed it: its sender deleted their
        // account (users.purgeMemberMessagingData), or it was still being checked a week after it
        // was sent ("expired", conversation/attachmentModerationStore.sweepUncheckedSentPhotos).
        // Its blobs are deleted, the row keeps its size (after an account deletion also the
        // blurhash of a photo recipients could see), and the thread shows "Photo no longer
        // available".
        removedReason: v.optional(
          v.union(v.literal("account_deleted"), v.literal("expired")),
        ),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      // A shared location (spec 2.4, R.5/R.6). `lat`/`lng` are stored already rounded by the
      // domain SharedLocation (5 decimals when exact, the ~1 km grid when approximate): the raw
      // device fix is never stored. `mapFileId` is the preview PNG rendered once at send time
      // (conversation/renderLocationMap); `mapStatus` "failed" falls back to a text card. The
      // message is appended once the render has settled (ready or failed).
      v.object({
        kind: v.literal("location"),
        threadAggregateId: v.string(),
        uploaderId: v.id("users"),
        // Absent once cleared: a moderator removed the location (after the evidence copy of its
        // map was taken; reports/attachmentEvidence), or the account was deleted. The label goes
        // with them.
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
        precision: v.union(v.literal("exact"), v.literal("approximate")),
        label: v.optional(v.string()),
        mapFileId: v.optional(v.id("_storage")),
        mapStatus: v.union(
          v.literal("pending"),
          v.literal("ready"),
          v.literal("failed"),
        ),
        caption: v.optional(v.string()),
        // The appended location message (absent = render not settled yet). Set once.
        messageId: v.optional(v.string()),
        // An open report references it: its map blob is never deleted by removal.
        evidenceHold: v.optional(v.boolean()),
        // A moderator removed it after a report (its message is tombstoned, the map deleted).
        removedAt: v.optional(v.number()),
        // Removed because its sender deleted their account: the map is deleted and the
        // coordinates and label cleared (users.purgeMemberMessagingData).
        removedReason: v.optional(v.literal("account_deleted")),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
  )
    .index("by_thread_uploader", ["threadAggregateId", "uploaderId"])
    // A sender's per-thread reads, bounded to what they need instead of their whole photo
    // history: the undelivered rows (messageId undefined: the outbox, a block's drop) and one
    // send batch (its sendRequestedAt: settleSendBatch and Send's batch-instant collision check).
    .index("by_thread_uploader_message", [
      "threadAggregateId",
      "uploaderId",
      "messageId",
    ])
    .index("by_thread_uploader_batch", [
      "threadAggregateId",
      "uploaderId",
      "sendRequestedAt",
    ])
    .index("by_file", ["fileId"])
    // Whether a blob is a photo's smaller rendition or a location's map preview
    // (lib/imageModeration/blobReferences: a claim refuses it, a delete keeps it).
    .index("by_thumb_file", ["thumbFileId"])
    .index("by_map_file", ["mapFileId"])
    .index("by_moderation_status", ["moderationStatus"])
    .index("by_message", ["messageId"])
    // Open review requests (admin/listImageReviewRequests, and the bounded count in
    // admin/getPendingCounts): rejected, reviewDecidedAt undefined, reviewRequestedAt set; oldest
    // request first. Decided requests keep reviewRequestedAt and quarantined ones never reach an
    // admin, so this range holds only what still waits. Any other reader of the open requests uses
    // this index rather than another one with the same fields.
    .index("by_review_awaiting", [
      "moderationStatus",
      "reviewDecidedAt",
      "reviewRequestedAt",
    ])
    .index("by_hash_check_pending", ["hashCheckPendingSince"])
    // Timed-out hash checks still closed (admin/listUncheckedPhotos): hashCheckedAt undefined.
    .index("by_hash_check_timed_out", ["hashCheckedAt", "hashCheckTimedOutAt"])
    // Published without a hash check, none configured (admin/listCsamEscalations counts them).
    .index("by_hash_check_skipped", ["hashCheckSkippedAt"])
    // A member's own attachments, for the account-deletion purge.
    .index("by_uploader", ["uploaderId"]),

  // A location-picker view the member rendered around their device position ("Use my current
  // location"; conversation/renderPickerMap in GPS mode). The light server-side signal behind the
  // precision guardrail: sendLocation treats a "pin" close to one of these as current location
  // (sharedLocations.GPS_MATCH_RADIUS_METRES). Coordinates rounded to 3 decimals (~110 m), never
  // the raw fix; each row is deleted GPS_VIEW_TTL_MS (15 min) after it was recorded.
  locationGpsViews: defineTable({
    memberId: v.id("users"),
    threadAggregateId: v.string(),
    lat: v.number(),
    lng: v.number(),
    createdAt: v.number(),
  }).index("by_member_thread", ["memberId", "threadAggregateId", "createdAt"]),

  // A participant tapped "Show" on a blurred message photo (conversation/revealMessageImage).
  // Blurred photos carry no URL in the thread read; once a viewer has revealed one, the read
  // serves its URL to that viewer, so it doesn't re-blur on every render. Per viewer, never shared.
  messageImageReveals: defineTable({
    attachmentId: v.id("messageAttachments"),
    viewerId: v.id("users"),
    revealedAt: v.number(),
  })
    .index("by_attachment_viewer", ["attachmentId", "viewerId"])
    // A member's own reveals, for the account-deletion purge.
    .index("by_viewer", ["viewerId"]),

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
    // Circle threads: the member's history floor (they see only messages sent strictly after it),
    // their circle join time. Absent on exchange/DM rows (no floor). A re-join is a fresh row.
    joinedAt: v.optional(v.number()),
    // The member muted the thread: left out of the shell's unread badge. Absent = not muted.
    muted: v.optional(v.boolean()),
    // The last time a message in this thread was pushed to the member: the push throttle (at most
    // one per thread per member per PUSH_THROTTLE_MS). Absent = never pushed.
    lastPushedAt: v.optional(v.number()),
    // Circle thread email digest: a digest is scheduled to fire at emailPendingUntil (absent = none
    // pending).
    emailPendingUntil: v.optional(v.number()),
    // When the member was last emailed about this thread: a circle digest (at most one per 6 h), or
    // a DM or exchange message. Either way no second email while lastEmailedAt > lastReadAt (one
    // per unread run). Absent = never emailed.
    lastEmailedAt: v.optional(v.number()),
  })
    .index("by_member", ["memberId"])
    .index("by_thread", ["threadAggregateId"])
    .index("by_thread_member", ["threadAggregateId", "memberId"])
    .index("by_member_activity", ["memberId", "lastActivityAt"])
    // The unread badge (getUnreadTotal): a member's unmuted rows (`muted` absent; setThreadMuted
    // never stores false) with unread messages, biggest count first.
    .index("by_member_unread", ["memberId", "muted", "unreadCount"]),

  // "Is typing" in a thread (conversation/setTyping, spec 4.3): at most one row per (thread,
  // member), patched in place and throttled server-side on `writtenAt`. clearTyping only unsets
  // `typingAt`, so the row (and its throttle) survives a stop. Readers treat a `typingAt` older
  // than TYPING_TTL_MS as stale; rows go on send, on leaving a circle, on circle deletion and on
  // account deletion, never by a sweeper (a stale row is bounded and harmless).
  typingIndicators: defineTable({
    threadAggregateId: v.string(),
    memberId: v.id("users"),
    // When the member last signalled typing; absent once they stopped (clearTyping).
    typingAt: v.optional(v.number()),
    // The row's last write (set or clear): the throttle clock.
    writtenAt: v.number(),
  })
    .index("by_thread", ["threadAggregateId"])
    .index("by_thread_member", ["threadAggregateId", "memberId"])
    // setTyping's per-member cap (the member's latest write, any thread) and the account-deletion
    // purge.
    .index("by_member", ["memberId", "writtenAt"]),

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
      v.literal("trade_cancelled_member_deleted"),
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
      v.literal("household_join_request_received"),
      v.literal("household_join_request_approved"),
      v.literal("connection_offer_received"),
      v.literal("circle_invite_received"),
      v.literal("circle_invite_accepted"),
      v.literal("circle_deleted"),
      v.literal("circle_message_received"),
      v.literal("whats_new"),
      v.literal("report_decided"),
      v.literal("content_removed"),
      v.literal("member_warned"),
      v.literal("message_image_rejected"),
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
    // follow request, invite, household, circle invite, circle, review, proposal, whats-new and
    // connection-offer ids are opaque aggregate ids; puzzle/copy/goal are the Convex `_id`s every
    // producer already holds.
    subject: v.optional(
      v.union(
        v.object({ kind: v.literal("exchange"), exchangeId: v.string() }),
        v.object({ kind: v.literal("thread"), threadId: v.string() }),
        v.object({ kind: v.literal("followRequest"), requestId: v.string() }),
        v.object({ kind: v.literal("householdInvite"), inviteId: v.string() }),
        v.object({ kind: v.literal("household"), householdId: v.string() }),
        v.object({
          kind: v.literal("householdJoinRequest"),
          requestId: v.string(),
        }),
        v.object({ kind: v.literal("circleInvite"), inviteId: v.string() }),
        v.object({ kind: v.literal("circle"), circleId: v.string() }),
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
    // How many items a grouped admin review row stands for (SEC-26), for groups whose copy counts
    // them. Absent = one; a row that absorbed no second item never carries it.
    itemCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "isRead"])
    .index("by_user_group", ["userId", "groupKey", "isRead"])
    // Account deletion: a recipient's notifications of one type, to find those pointing at a
    // purged invite or offer (conversation/purgeMemberMessagingData).
    .index("by_user_type", ["userId", "type"])
    .index("by_type", ["type"])
    .index("by_created_at", ["createdAt"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Per-member NotificationPreference: which (type, channel) deliveries the member accepts. One
  // row per member; `toggles` is the resolved type->channel->enabled map (stored as JSON via
  // v.any so the domain shape maps field-for-field without enumerating literals here).
  notificationPreferences: defineTable({
    aggregateId: v.optional(v.string()),
    memberId: v.id("users"),
    toggles: v.any(),
    // Whether email / push may quote a message's text (SEC-64). Absent, or a channel absent,
    // means the domain default: email no, push yes.
    messagePreviews: v.optional(
      v.object({
        email: v.optional(v.boolean()),
        push: v.optional(v.boolean()),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // Solving-context member preferences (federated settings: each context owns its settings).
  // Keyed by member; `trackCompletionDuration` undefined = never chosen: the solve dialogs still
  // ask for a time (only `false` hides it) and offer to turn it off.
  solvingPreferences: defineTable({
    memberId: v.id("users"),
    trackCompletionDuration: v.optional(v.boolean()),
    // Friend-facing in-progress sharing. undefined = never chosen; every gate tests `=== true`.
    shareInProgress: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),

  // Presence settings (federated settings, owned by social). One row per member; no row = never
  // asked, override "auto". `share` undefined = never chosen; every gate tests `=== true`.
  presencePreferences: defineTable({
    memberId: v.id("users"),
    share: v.optional(v.boolean()),
    override: v.union(
      v.literal("auto"),
      v.literal("away"),
      v.literal("invisible"),
    ),
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

  // A circle's icon uploads (sharing/circleIcons.ts), one row per upload, through the shared image
  // moderation pipeline (sharing/moderateCircleIcon). Kept apart from `circles`, which the Circle
  // aggregate's repository saves as a whole. The icon members see is the newest row that is
  // "approved" with its hash check passed; a newer upload still being checked leaves it in place.
  // Once a newer row is servable the older ones go (row and blob), as do the others on remove.
  circleIcons: defineTable({
    // The circle's CircleId aggregateId (outlives the circles row, for the purge).
    circleId: v.string(),
    uploaderId: v.id("users"),
    fileId: v.id("_storage"),
    // The clean image's blurhash (lib/blurhash), set with the re-encode.
    blurhash: v.optional(v.string()),
    // The image-table lifecycle of the shared moderation pipeline (lib/imageModeration).
    moderationStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("unscored"),
      // A CSAM hash-list match: never served to anyone; row and blob are kept.
      v.literal("quarantined"),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
    // When the pipeline swapped the row to its re-encoded blob (absent = still the upload).
    reencodedAt: v.optional(v.number()),
    // The admin who decided it by hand (admin/decideUncheckedPhoto); a manual decision is final.
    moderatedBy: v.optional(v.id("users")),
    // When the uploader closed the "removed" notice of a rejected icon.
    noticeDismissedAt: v.optional(v.number()),
    // CSAM hash-check bookkeeping + publication gate (lib/imageModeration/hashCheckFields).
    ...hashCheckFields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_circle", ["circleId"])
    .index("by_file", ["fileId"])
    .index("by_moderation_status", ["moderationStatus"])
    .index("by_hash_check_pending", ["hashCheckPendingSince"])
    // Timed-out hash checks still closed (admin/listUncheckedPhotos): hashCheckedAt undefined.
    .index("by_hash_check_timed_out", ["hashCheckedAt", "hashCheckTimedOutAt"])
    // Published without a hash check, none configured (admin/listCsamEscalations counts them).
    .index("by_hash_check_skipped", ["hashCheckSkippedAt"]),

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

  // Circle invitations (CircleInvite aggregate). A pending invite is NOT a membership: it grants
  // nothing until the invitee accepts and is seated in `circles.memberships`. "pending" past
  // `expiresAt` reads as expired (lazy); a scheduled expireCircleInvite flips the stored status.
  circleInvites: defineTable({
    aggregateId: v.string(), // CircleInviteId
    circleAggregateId: v.string(), // CircleId
    inviteeId: v.id("users"),
    inviterId: v.id("users"),
    permission: v.union(
      v.literal("ViewOnly"),
      v.literal("Exchange"),
      v.literal("Admin"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    // The member who revoked it; absent when the system withdrew it (its inviter left or lost
    // Admin), which holds off no re-invite.
    revokedBy: v.optional(v.id("users")),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_invitee_status", ["inviteeId", "status"])
    .index("by_circle_status", ["circleAggregateId", "status"])
    .index("by_circle_invitee", ["circleAggregateId", "inviteeId"])
    // Account deletion: the invites a member sent (conversation/purgeMemberMessagingData).
    .index("by_inviter", ["inviterId"]),

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
    // Set while library/ownerListingVisibility is re-stamping this member's copies after a visibility
    // change, so a flip that lands meanwhile doesn't start a second run. Absent otherwise.
    listingSyncSince: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_aggregate_id", ["aggregateId"]),

  // Social: a community comment on a PUZZLE DEFINITION (shared across every owned copy of that
  // puzzle). A lightweight post: trimmed text + author + when; never edited, and only its author
  // may delete it (social/deletePuzzleComment, SEC-70).
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
    .index("by_copy", ["copyId"])
    // The author's delete finds the comment by the id the read side shows (its aggregateId).
    .index("by_aggregate_id", ["aggregateId"])
    // Everything one member wrote (social/removeMemberContent).
    .index("by_author", ["authorId", "createdAt"]),

  // Social: a text-only discussion comment on a single shared PHOTO (an `ownedPuzzleImages` row),
  // surfaced in the photo lightbox. Keyed by the photo _id (not a puzzle definition); aggregateId is
  // the PhotoCommentId (the id the web holds, and a photoComment report's target). Never edited.
  // Only its author may delete it (library/deletePhotoComment, SEC-70), and a moderator deletes a
  // reported one (admin/decideReport). The read side projects this table directly into view DTOs.
  photoComments: defineTable({
    aggregateId: v.optional(v.string()),
    photoId: v.id("ownedPuzzleImages"),
    authorId: v.id("users"),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_photo", ["photoId"])
    // The author's delete and a report's target find the comment by the id the read side shows
    // (its aggregateId).
    .index("by_aggregate_id", ["aggregateId"])
    // Everything one member wrote (social/removeMemberContent).
    .index("by_author", ["authorId", "createdAt"]),

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
  })
    .index("by_new_member", ["newMemberId"])
    // Account deletion: the redemptions of an inviter's links (conversation/purgeMemberMessagingData).
    .index("by_inviter", ["inviterId"]),

  // Social: confirm-first connection offers (ConnectionOffer aggregate). Redeeming an invite link
  // at sign-up offers the new member (toId) a mutual follow with the link's owner (fromId); nothing
  // is followed until they accept. inviteLinkId attributes an accept to the link's
  // followsEstablished; an email invitation (source "emailInvite") offers the same with none. At
  // most one pending row per ordered pair (by_from_to_status); expiry is lazy (reads check
  // expiresAt) plus a scheduled expire at expiresAt.
  connectionOffers: defineTable({
    aggregateId: v.string(),
    fromId: v.id("users"),
    toId: v.id("users"),
    source: v.union(
      v.literal("inviteLink"),
      v.literal("householdLink"),
      v.literal("emailInvite"),
    ),
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
    // The members' own name for the household (normalised, 1-100 chars); absent = unnamed. Only
    // ever returned to members of this household (household/getMyHousehold).
    name: v.optional(v.string()),
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
    // Made by an email invitation whose address already had an account (invitations/fallbacks).
    // Left out of the admin's named pending list (getMyHousehold), which shows it only as the
    // email invitation's "Invitation sent", so the list never reveals that the address had an
    // account. Replaced by a fresh invite when the admin also invites the member in-app
    // (inviteToHousehold).
    viaEmail: v.optional(v.boolean()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_invitee_status", ["inviteeId", "status"])
    .index("by_household", ["householdId"])
    // Account deletion (conversation/purgeMemberMessagingData householdInvitesOut).
    .index("by_inviter", ["inviterId"]),

  // A member's request to join a household, asked from an expired or used household invite link
  // (HouseholdJoinRequest aggregate). One per (requester, link), ever; lapses 14 days after
  // createdAt (expiresAt, read lazily: no cron). `dropped` requests (household gone, link owner no
  // longer its admin, or the pair blocked) are kept so the requester's answer never differs, but no
  // admin ever sees them. leaveHouseholdId + leaveConsequence are the requester's consent to leave
  // the household they were in when they asked (both absent when they were in none).
  householdJoinRequests: defineTable({
    aggregateId: v.string(), // HouseholdJoinRequestId
    householdId: v.string(), // HouseholdId the link was minted for
    requesterId: v.id("users"),
    // The link's owner, who is told (and whose notification about it goes on withdraw / purge).
    adminId: v.id("users"),
    linkId: v.id("inviteLinks"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("withdrawn"),
      v.literal("void"),
    ),
    dropped: v.boolean(),
    leaveHouseholdId: v.optional(v.string()),
    leaveConsequence: v.optional(
      v.union(v.literal("deleted"), v.literal("handover"), v.literal("leave")),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    // The requester's open request; account deletion (householdJoinRequestsOut).
    .index("by_requester", ["requesterId", "status"])
    // The admin's list (getMyHousehold).
    .index("by_household_status", ["householdId", "status"])
    .index("by_link_requester", ["linkId", "requesterId"]),

  // Email invitations (#222, invitations/): the inviter's local reference for one invitation sent by
  // email to someone who is not on JigSwap yet. It stores NO email address, so the pending list
  // reads "Invitation sent {createdAt}" whether or not the address had an account. aggregateId is
  // the opaque ref carried in the Clerk invitation's public metadata. One row per send, kept for
  // 14 days (a scheduled expireEmailInvite at expiresAt; reads check expiresAt too). fallback holds
  // the in-app invite made instead when the address already belonged to a member.
  emailInvites: defineTable({
    aggregateId: v.string(),
    kind: v.union(v.literal("follow"), v.literal("household")),
    inviterId: v.id("users"),
    householdId: v.optional(v.string()), // HouseholdId, household invites only
    clerkInvitationId: v.optional(v.string()),
    fallback: v.optional(
      v.object({
        connectionOfferId: v.optional(v.string()),
        householdInviteId: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_inviter", ["inviterId", "kind", "createdAt"])
    // The household admin's pending list: every pending household invitation, whoever sent it.
    .index("by_household", ["householdId", "createdAt"]),

  // The per-address cap for invitation emails (1 per 30 days across all inviters). The address is
  // kept only as HMAC-SHA256(INVITE_EMAIL_HMAC_KEY, address), with no member id; each row is
  // deleted 30 days after sentAt.
  emailInviteSendLog: defineTable({
    emailHmac: v.string(),
    sentAt: v.number(),
  }).index("by_hmac", ["emailHmac", "sentAt"]),

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
    // Backs the activity feed: pull recent events of a given name in a bounded time window without
    // a full-table scan-and-filter.
    .index("by_name", ["name", "occurredAt"]),

  // Which members a domainEvents payload names: one row per (event, users id anywhere in the
  // payload), written with the event by events/recordAndSchedule. The account purge finds a
  // member's events through by_member instead of paging the whole log; rows recorded before this
  // table existed are added by events/eventMembers backfillEventMembers, which writes the
  // "domainEventMembers" backfill marker when done (until then the purge pages the log). A row
  // goes with its event, or once the purge has scrubbed the member out of the payload.
  domainEventMembers: defineTable({
    eventId: v.id("domainEvents"),
    memberId: v.id("users"),
  })
    .index("by_member", ["memberId"])
    .index("by_event", ["eventId", "memberId"]),

  // One row per finished one-shot backfill that code waits on before it relies on the data the
  // backfill writes (name = the backfill, e.g. "domainEventMembers").
  backfillMarkers: defineTable({
    name: v.string(),
    completedAt: v.number(),
  }).index("by_name", ["name"]),

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

  // The activity feed's per-actor read model (SEC-30, PERF-B3m): one row per piece of activity a
  // member did, written by the event dispatcher (social/activityEntries.projectActivityEvent) from
  // the feed's four events. The feed reads each audience member's own range of by_actor_time, so
  // one member's events never crowd out another's and a new row only touches the feeds of the
  // actor's followers. Only viewer-independent facts are stored; the viewer gates (started opt-in
  // and mutual follow, profile unlock, canViewCopy, blocks) still run at read time.
  //   kind/ref    the feed entry: "completion"/"started" -> completionId, "acquisition" -> copyId,
  //               "acquisitionBatch" -> batchId, "exchange" -> exchangeId. One row per
  //               (actorId, kind, ref): by_actor_kind_ref keeps the projection idempotent.
  //   occurredAt  the event time (a batch: its newest event)
  //   copyIds     acquisitionBatch only: the batch's copies (ownedPuzzles.aggregateId)
  //   startDate   started only: the solve's start; the feed hides it until then
  //   partyIds    exchange only: [initiator, recipient]; a party gets its own row
  activityEntries: defineTable({
    actorId: v.id("users"),
    kind: v.union(
      v.literal("completion"),
      v.literal("started"),
      v.literal("acquisition"),
      v.literal("acquisitionBatch"),
      v.literal("exchange"),
    ),
    ref: v.string(),
    occurredAt: v.number(),
    copyIds: v.optional(v.array(v.string())),
    startDate: v.optional(v.number()),
    partyIds: v.optional(v.array(v.id("users"))),
  })
    .index("by_actor_time", ["actorId", "occurredAt"])
    .index("by_actor_kind_ref", ["actorId", "kind", "ref"]),

  // One row per read model whose one-shot backfill has finished on this deployment. A read that
  // depends on a backfilled model keeps its legacy path until the row exists. Written only by the
  // backfill's last batch ("activityEntries": social/backfillActivityEntries).
  readModelStatus: defineTable({
    name: v.string(),
    completedAt: v.number(),
  }).index("by_name", ["name"]),

  // The public landing page's counters (PERF-B2m), so insights/getGlobalStats reads one row instead
  // of every users, puzzles and ownedPuzzles row. One row, key "global", rewritten by
  // insights/platformStats.recount (a weekly cron that recounts the three tables, with a daily
  // top-up of new rows), so the numbers may be up to a day old, and a deleted row counted for up to
  // a week. Same meaning as the legacy count: every row of each table.
  platformStats: defineTable({
    key: v.string(),
    users: v.number(),
    puzzles: v.number(),
    ownedPuzzles: v.number(),
    countedAt: v.number(),
  }).index("by_key", ["key"]),

  // Per-member library counters (PERF-B5q), so a shelf reads one row instead of scanning the member's
  // copies: an edit that moves neither number then re-runs nothing subscribed to them. Kept in step
  // by every write that adds, removes, re-owns or re-offers a copy (library/memberLibraryCounts).
  // A member without a row (before library/backfillMemberLibraryCounts reaches them, or past its scan
  // cap) is counted from their copies at read time.
  memberLibraryCounts: defineTable({
    memberId: v.id("users"),
    owned: v.number(),
    forTrade: v.number(),
  }).index("by_member", ["memberId"]),

  // Per-definition aggregates the catalog and definition pages show (PERF-B4m, SEC-29), so a page
  // reads one row instead of every review, copy and completion of the definition. Only the
  // viewer-independent parts; what depends on the viewer (their household's private copies, the
  // copies they can reach) is still read per request. Written only by
  // library/definitionStats.recompute, which recomputes a definition from source when a write has
  // marked it, and weekly for every definition (the reconcile, which is also the backfill).
  //   totals      the sums the pages derive their numbers from (library/definitionAggregates);
  //               absent until the first recompute, and reads compute live meanwhile
  //     breakdown        rated reviews per star, [5★, 4★, 3★, 2★, 1★]
  //     communityOwners  distinct owners of a copy that is not private
  //     ownerCount       distinct owners of any copy, private ones included, for the admin console;
  //                      absent until the row's next recompute (weekly at the latest)
  //     publicAvailable  open copies of public-profile owners, by priority swap type
  //   stale, staleSince  written before marks moved to definitionStatsPending; only a recompute
  //               still reads them, to clear them
  //   computedAt  when the totals were last written
  definitionStats: defineTable({
    puzzleId: v.id("puzzles"),
    totals: v.optional(
      v.object({
        ratingCount: v.number(),
        ratingSum: v.number(),
        breakdown: v.array(v.number()),
        completedCount: v.number(),
        finishDaysSum: v.number(),
        finishDaysCount: v.number(),
        communityOwners: v.number(),
        ownerCount: v.optional(v.number()),
        publicAvailable: v.object({
          swap: v.number(),
          lend: v.number(),
          sale: v.number(),
        }),
      }),
    ),
    stale: v.optional(v.boolean()),
    staleSince: v.optional(v.number()),
    computedAt: v.optional(v.number()),
  }).index("by_puzzle", ["puzzleId"]),

  // A write changed this definition's sources and a recompute is scheduled (library/definitionStats).
  // Apart from definitionStats because every page showing the definition subscribes to that row: a
  // mark, and a recompute that finds nothing changed, must not re-run them. Deleted by the recompute.
  //   since  when it was marked (or its recompute last re-scheduled). A mark, or the reconcile, that
  //          finds it older than a few minutes takes it that the recompute failed: it logs that and
  //          schedules another
  definitionStatsPending: defineTable({
    puzzleId: v.id("puzzles"),
    since: v.number(),
  }).index("by_puzzle", ["puzzleId"]),

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

  // DSA notice-and-action (spec 2.5): a member's report about another member or their content.
  // Filing never changes the target; an admin decides it (admin/decideReport), which may tombstone
  // a message, remove a photo or a photo comment, or clear a review's text. `targetId` is the
  // target's canonical id string: users / copy / photo / attachment / puzzleReviews `_id`, the
  // threadMessages `messageId`, or the exchange or photo comment aggregateId (raw `_id` fallback).
  // `evidence` is snapshotted at filing time so later edits or removal can't destroy it.
  reports: defineTable({
    // Absent once the reporter is anonymised: they deleted their account, or the report reached
    // the end of its retention (12 months after the decision). `reporterAnonymisedAt` marks it.
    reporterId: v.optional(v.id("users")),
    reporterAnonymisedAt: v.optional(v.number()),
    targetKind: v.union(
      v.literal("user"),
      v.literal("message"),
      v.literal("copy"),
      v.literal("photo"),
      v.literal("exchange"),
      // A message photo (messageAttachments `_id`).
      v.literal("attachment"),
      // A comment on a copy photo (photoComments aggregateId, raw `_id` for legacy rows).
      v.literal("photoComment"),
      // The text of a review on a catalogue puzzle (puzzleReviews `_id`).
      v.literal("puzzleReview"),
    ),
    targetId: v.string(),
    reportedUserId: v.id("users"),
    reason: v.union(
      v.literal("spam_scam"),
      v.literal("harassment_hate"),
      v.literal("sexual"),
      v.literal("fake_trade"),
      v.literal("illegal"),
      v.literal("other"),
    ),
    details: v.optional(v.string()), // <= 1000 characters
    // DSA Art. 16(2) notice elements; present iff reason === "illegal".
    illegalNotice: v.optional(
      v.object({
        // Absent once the reporter is anonymised (see reporterId).
        notifierName: v.optional(v.string()),
        // Only when it differs from the reporter's account email; read falls back to the account's.
        notifierEmail: v.optional(v.string()),
        goodFaith: v.literal(true),
      }),
    ),
    evidence: v.object({
      // message target: up to 10 preceding messages of the thread plus the target, ascending.
      messages: v.optional(
        v.array(
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
            // The media message's attachment (image rows), held while the report is open.
            attachmentId: v.optional(v.id("messageAttachments")),
            // Already moderator-removed when the report was filed: body "" and no copyId.
            removed: v.optional(v.literal(true)),
          }),
        ),
      ),
      // photoComment / puzzleReview target: the reported text as filed (a legacy over-long text
      // cut to reports/fileReport EVIDENCE_TEXT_MAX_LENGTH). Cleared by the retention purge.
      text: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("open"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    decision: v.optional(
      v.union(
        v.literal("dismissed"),
        v.literal("content_removed"),
        v.literal("warned"),
      ),
    ),
    statementOfReasons: v.optional(v.string()),
    // content_removed on a message photo: a copy of its bytes in a NEW blob that only this report
    // references (admin evidence; the served blob is deleted, so issued URLs die), kept until
    // `evidenceRetainUntil` (decision + 6 months, spec 2.8; purged by the retention job).
    evidenceFileId: v.optional(v.id("_storage")),
    evidenceRetainUntil: v.optional(v.number()),
    // Set while the evidence copy is being made (reports/attachmentEvidence); cleared with it.
    evidencePendingSince: v.optional(v.number()),
    // The copy could not be made (source gone, or the attempts ran out); the photo was still
    // removed and its served blob deleted.
    evidenceMissing: v.optional(v.boolean()),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    // The retention purge ran (reports/retention, 12 months after the decision): the reporter is
    // anonymised and the details, the evidence message bodies and the evidence text are cleared.
    retentionPurgedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_target", ["targetKind", "targetId"])
    .index("by_reporter_target", ["reporterId", "targetKind", "targetId"])
    .index("by_reporter_created", ["reporterId", "createdAt"])
    .index("by_reported_user", ["reportedUserId", "createdAt"])
    // The reports sharing one evidence copy (its purge; message-photo claims refuse it).
    .index("by_evidence_file", ["evidenceFileId"])
    // The daily retention backstop (reports/retention.sweepReportRetention): decided reports not
    // purged yet, by decision time, and evidence copies by the end of their retention.
    .index("by_retention_due", ["retentionPurgedAt", "decidedAt"])
    .index("by_evidence_retain", ["evidenceRetainUntil"]),

  // Fixed-window rate limit counters (lib/rateLimits). One row per key ("<limit>:<memberId>", or
  // "<limit>:<memberId>:<otherId>" for a per-pair limit such as followPair, or
  // "householdInvitePair:<householdId>:<inviteeId>", or
  // "followNotice:<channel>:<type>:<recipient>:<actor>"), reset in place when its window has
  // passed. Member keys keep the table bounded by the member count; pair and notice keys only by
  // what each member's own limits let them touch, and nothing prunes expired rows yet.
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    // The members a pair or notice key names, because account deletion can't look up an id in the
    // middle of a key (conversation/purgeMemberMessagingData). Only those rows carry them.
    pairActorId: v.optional(v.id("users")),
    pairTargetId: v.optional(v.id("users")),
  })
    .index("by_key", ["key"])
    .index("by_pair_actor", ["pairActorId"])
    .index("by_pair_target", ["pairTargetId"]),

  // One-shot maintenance steps that other code waits for (lib/maintenanceMarkers). One row per
  // step name, written by the step itself when its run proves it done.
  maintenanceMarkers: defineTable({
    name: v.string(),
    completedAt: v.number(),
  }).index("by_name", ["name"]),
});
