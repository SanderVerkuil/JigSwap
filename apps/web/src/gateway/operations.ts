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
    createPuzzle: api.puzzles.createPuzzle,
    updatePuzzle: api.puzzles.updatePuzzle,
    puzzleById: api.puzzles.getPuzzleById,
    listAll: api.puzzles.listAllpuzzles,
    recentPuzzles: api.puzzles.getRecentPuzzles,
    allBrands: api.puzzles.getAllBrands,
    allTags: api.puzzles.getAllTags,
    puzzleCategories: api.puzzles.getPuzzleCategories,
    puzzleSuggestions: api.puzzles.getPuzzleSuggestions,
  },

  // Personal Library: a member's owned copies and their organisation.
  library: {
    createOwned: api.puzzles.createOwnedPuzzle,
    updateOwned: api.puzzles.updateOwnedPuzzle,
    deleteOwned: api.puzzles.deleteOwnedPuzzle,
    ownedByOwner: api.puzzles.getOwnedPuzzlesByOwner,
    // Browse reads from the Library inventory (owned copies), not the Catalog.
    browseOwned: api.puzzles.browseOwnedPuzzles,
    ownedWithCollectionStatus: api.puzzles.getOwnedPuzzleWithCollectionStatus,
    // Image upload is a Library (Copy) concern; the URL is used for copy photos.
    generateUploadUrl: api.puzzles.generateUploadUrl,
  },

  // Personal Library: collections (a member's private organisation of copies).
  collections: {
    create: api.collections.createCollection,
    update: api.collections.updateCollection,
    delete: api.collections.deleteCollection,
    listForUser: api.collections.getUserCollections,
    byId: api.collections.getCollectionById,
    addOwnedPuzzle: api.collections.addOwnedPuzzleToCollection,
    removeOwnedPuzzle: api.collections.removeOwnedPuzzleFromCollection,
    forOwnedPuzzle: api.collections.getCollectionsForOwnedPuzzle,
  },

  // Exchange (Trading): proposing, settling, and messaging on exchanges.
  exchange: {
    create: api.exchanges.createExchange,
    byId: api.exchanges.getExchangeById,
    forUser: api.exchanges.getUserExchanges,
    incoming: api.exchanges.getExchangesByOwner,
    outgoing: api.exchanges.getExchangesByRequester,
    updateStatus: api.exchanges.updateExchangeStatus,
    accept: api.exchanges.acceptExchange,
    decline: api.exchanges.declineExchange,
    complete: api.exchanges.completeExchange,
    cancel: api.exchanges.cancelExchange,
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

  // Insights: read-side aggregate stats across the platform.
  insights: {
    globalStats: api.users.getGlobalStats,
  },

  // Catalog moderation: the global, moderated category taxonomy (admin).
  adminCatalog: {
    listAll: api.adminCategories.getAllAdminCategories,
    listActive: api.adminCategories.getActiveAdminCategories,
    byId: api.adminCategories.getAdminCategoryById,
    create: api.adminCategories.createAdminCategory,
    update: api.adminCategories.updateAdminCategory,
    delete: api.adminCategories.deleteAdminCategory,
    reorder: api.adminCategories.reorderAdminCategories,
  },
} as const;
