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
    // Reads go through the domain-driven catalog module (file.export namespacing); each is a thin
    // Convex query returning a typed @jigswap/contracts view DTO, not a raw row. Public
    // lists/suggestions already filter to approved definitions only.
    puzzleById: api.catalog.getPuzzleById.getPuzzleById,
    listAll: api.catalog.listAllPuzzles.listAllPuzzles,
    recentPuzzles: api.catalog.getRecentPuzzles.getRecentPuzzles,
    pending: api.catalog.listPendingPuzzleDefinitions.listPendingPuzzleDefinitions,
    // The current member's own not-yet-approved submissions, so the add-copy picker can offer
    // a copy of a puzzle they contributed before it is approved.
    myContributedPuzzles:
      api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
    allBrands: api.catalog.getAllBrands.getAllBrands,
    allTags: api.catalog.getAllTags.getAllTags,
    puzzleCategories: api.catalog.getPuzzleCategories.getPuzzleCategories,
    puzzleSuggestions: api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
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
    // Reads go through the domain-driven library module (file.export namespacing); each is a thin
    // Convex query returning a typed @jigswap/contracts view DTO, not a raw row.
    ownedByOwner: api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
    // Browse reads from the Library inventory (owned copies), not the Catalog.
    browseOwned: api.library.browseOwnedPuzzles.browseOwnedPuzzles,
    ownedWithCollectionStatus:
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
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
    // Reads go through the domain-driven library module (collections are a Personal Library
    // concern); each is a thin Convex query returning a typed @jigswap/contracts view DTO.
    listForUser: api.library.getUserCollections.getUserCollections,
    byId: api.library.getCollectionById.getCollectionById,
    addOwnedPuzzle: api.library.addCopyToCollection.addCopyToCollection,
    removeOwnedPuzzle:
      api.library.removeCopyFromCollection.removeCopyFromCollection,
    forOwnedPuzzle:
      api.library.getCollectionsForOwnedPuzzle.getCollectionsForOwnedPuzzle,
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

  // Solving: solve tracking, puzzle reviews, goals. Ownership / 24h edit window / rating are
  // enforced in the domain; reads surface server-derived state (photo URLs, goal isAchieved).
  solving: {
    recordCompletion: api.solving.recordCompletion.recordCompletion,
    finishCompletion: api.solving.finishCompletion.finishCompletion,
    editCompletion: api.solving.editCompletion.editCompletion,
    reviewPuzzle: api.solving.reviewPuzzle.reviewPuzzle,
    createGoal: api.solving.createGoal.createGoal,
    myCompletions: api.solving.listMyCompletions.listMyCompletions,
    completionHistory: api.solving.getCompletionHistory.getCompletionHistory,
    myGoals: api.solving.listMyGoals.listMyGoals,
  },

  // Reputation: partner reviews after a completed Exchange + the per-member profile projection.
  // submitReview.exchangeId is the Exchange aggregateId; reviewee/member are user _ids (MemberId).
  reputation: {
    submitReview: api.reputation.submitPartnerReview.submitPartnerReview,
    profile: api.reputation.getReputationProfile.getReputationProfile,
    reviewsForMember: api.reputation.listReviewsForMember.listReviewsForMember,
    myReviewForExchange: api.reputation.getMyReviewForExchange.getMyReviewForExchange,
  },

  // Notifications: the per-member in-app inbox + delivery preferences. A pure subscriber context
  // (events from other contexts produce rows); the UI only reads its own and toggles read/prefs.
  // `markRead` takes the notification aggregateId, not the Convex _id.
  notifications: {
    list: api.notifications.listMyNotifications.listMyNotifications,
    unreadCount: api.notifications.unreadCount.unreadCount,
    markRead: api.notifications.markNotificationRead.markNotificationRead,
    markAllRead: api.notifications.markAllRead.markAllRead,
    preferences: api.notifications.getMyPreferences.getMyPreferences,
    updatePreference:
      api.notifications.updateNotificationPreference.updateNotificationPreference,
  },

  // Insights: read-side aggregate stats. globalStats is platform-wide; the rest are the signed-in
  // member's own analytics (personal stats, trends, breakdowns) plus a self-service data export.
  insights: {
    globalStats: api.users.getGlobalStats,
    personalStats: api.insights.getPersonalStats.getPersonalStats,
    completionTrends: api.insights.getCompletionTrends.getCompletionTrends,
    collectionBreakdown:
      api.insights.getCollectionBreakdown.getCollectionBreakdown,
    tradeActivity: api.insights.getTradeActivity.getTradeActivity,
    // Downstream read-model: ranks approved catalog puzzles the member doesn't own from their taste.
    recommendations: api.insights.getRecommendations.getRecommendations,
    exportUserData: api.insights.exportUserData.exportUserData,
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
