import { api } from "@jigswap/backend/convex/_generated/api";

/**
 * The single chokepoint onto the Convex generated API. The UI references
 * functions through bounded-context groupings (per spec/architecture
 * 01-bounded-contexts.md §1.4), so a later BFF phase can swap the transport
 * here without touching components. References are passed through unchanged,
 * so reactivity, args, and "skip" semantics are identical to direct usage.
 */
export const gateway = {
  // Catalog: shared puzzle definitions, brands, tags, taxonomy, favorites.
  catalog: {
    // Writes go through the domain-driven catalog module (file.export namespacing); submissions
    // land as `pending` and must be approved (moderation) before appearing publicly.
    createPuzzle: api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    updatePuzzle: api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
    approve: api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    reject: api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
    // Reads remain on the legacy queries (read cutover is a later phase); public lists/suggestions
    // already filter to approved definitions only.
    puzzleById: api.puzzles.getPuzzleById,
    listAll: api.puzzles.listAllpuzzles,
    recentPuzzles: api.puzzles.getRecentPuzzles,
    pending: api.catalog.listPendingPuzzleDefinitions.listPendingPuzzleDefinitions,
    // The current member's own not-yet-approved submissions, so the add-copy picker can offer
    // a copy of a puzzle they contributed before it is approved.
    myContributedPuzzles:
      api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
    allBrands: api.puzzles.getAllBrands,
    allTags: api.puzzles.getAllTags,
    puzzleCategories: api.puzzles.getPuzzleCategories,
    puzzleSuggestions: api.puzzles.getPuzzleSuggestions,
  },

  // Personal Library: a member's owned copies and their organisation. Writes go through the
  // domain-driven library module (file.export namespacing); a copy is acquired against an
  // approved Catalog definition and re-graded/re-shared/re-detailed via granular mutations.
  library: {
    createOwned: api.library.acquireCopy.acquireCopy,
    // The legacy single updateOwned is split into granular Copy mutations; callers invoke only
    // those whose fields changed.
    changeCondition: api.library.changeCopyCondition.changeCopyCondition,
    updateSharing: api.library.updateCopySharing.updateCopySharing,
    updateDetails: api.library.updateCopyDetails.updateCopyDetails,
    addImage: api.library.addCopyImage.addCopyImage,
    deleteOwned: api.library.deleteCopy.deleteCopy,
    ownedByOwner: api.puzzles.getOwnedPuzzlesByOwner,
    // Browse reads from the Library inventory (owned copies), not the Catalog.
    browseOwned: api.puzzles.browseOwnedPuzzles,
    ownedWithCollectionStatus: api.puzzles.getOwnedPuzzleWithCollectionStatus,
    // Image upload is storage infra, not a domain op; keep it on the legacy function. The URL is
    // used for copy photos.
    generateUploadUrl: api.puzzles.generateUploadUrl,
  },

  // Personal Library: collections (a member's private organisation of copies). Writes go through
  // the domain-driven library module; identifiers are CollectionId/CopyId aggregateIds.
  collections: {
    create: api.library.createCollection.createCollection,
    update: api.library.updateCollection.updateCollection,
    delete: api.library.deleteCollection.deleteCollection,
    listForUser: api.collections.getUserCollections,
    byId: api.collections.getCollectionById,
    addOwnedPuzzle: api.library.addCopyToCollection.addCopyToCollection,
    removeOwnedPuzzle:
      api.library.removeCopyFromCollection.removeCopyFromCollection,
    forOwnedPuzzle: api.collections.getCollectionsForOwnedPuzzle,
  },

  // Exchange (Trading): proposing, settling, and messaging on exchanges.
  // Writes go through the domain-driven exchange module (file.export namespacing);
  // these enforce party-auth and legal transitions in the aggregate.
  exchange: {
    create: api.exchange.propose.propose,
    byId: api.exchanges.getExchangeById,
    forUser: api.exchanges.getUserExchanges,
    incoming: api.exchanges.getExchangesByOwner,
    outgoing: api.exchanges.getExchangesByRequester,
    accept: api.exchange.accept.accept,
    decline: api.exchange.decline.decline,
    complete: api.exchange.confirmCompletion.confirmCompletion,
    cancel: api.exchange.cancel.cancel,
    dispute: api.exchange.raiseDispute.raiseDispute,
    stats: api.exchanges.getExchangeStats,
    sendMessage: api.exchanges.sendExchangeMessage,
    messages: api.exchanges.getExchangeMessages,
  },

  // Identity & Access: the wrapper over Clerk members and their profiles.
  identity: {
    currentUser: api.users.getCurrentUser,
    byClerkId: api.users.getUserByClerkId,
    byId: api.users.getUserById,
    updateProfile: api.users.updateUserProfile,
    userStats: api.users.getUserStats,
    search: api.users.searchUsers,
  },

  // Solving: a member's solve tracking (completions), puzzle reviews, and goals. Writes go
  // through the domain-driven solving module (file.export namespacing) and enforce ownership,
  // the 24h completion edit window, and the 1–5 review rating in the aggregate. Reads are
  // auth-gated and surface server-derived state (photo URLs, goal `isAchieved`) so the UI never
  // recomputes it.
  solving: {
    // No endDate => an in-progress solve is started; with endDate => a finished solve is logged.
    recordCompletion: api.solving.recordCompletion.recordCompletion,
    finishCompletion: api.solving.finishCompletion.finishCompletion,
    // Mutable-field edit, gated server-side to a 24h window after creation.
    editCompletion: api.solving.editCompletion.editCompletion,
    // Attach a 1–5 PuzzleReview (opinion of the puzzle) to one of the member's completions.
    reviewPuzzle: api.solving.reviewPuzzle.reviewPuzzle,
    createGoal: api.solving.createGoal.createGoal,
    myCompletions: api.solving.listMyCompletions.listMyCompletions,
    completionHistory: api.solving.getCompletionHistory.getCompletionHistory,
    // Rows carry the server-derived `isAchieved` (current >= target).
    myGoals: api.solving.listMyGoals.listMyGoals,
  },

  // Insights: read-side aggregate stats across the platform.
  insights: {
    globalStats: api.users.getGlobalStats,
  },

  // Catalog moderation: the global, moderated category taxonomy (admin). Writes go through the
  // domain-driven catalog module; identifiers are CatalogCategoryId aggregateIds.
  adminCatalog: {
    listAll: api.adminCategories.getAllAdminCategories,
    listActive: api.adminCategories.getActiveAdminCategories,
    byId: api.adminCategories.getAdminCategoryById,
    create: api.catalog.createCatalogCategory.createCatalogCategory,
    update: api.catalog.updateCatalogCategory.updateCatalogCategory,
    reorder: api.catalog.reorderCatalogCategories.reorderCatalogCategories,
    // The domain soft-deactivates (no hard delete); "delete" hides a node via setActive(false).
    delete: api.catalog.setCatalogCategoryActive.setCatalogCategoryActive,
  },
} as const;
