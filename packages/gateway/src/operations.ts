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
    extractPuzzleFromUrl: api.catalog.extractFromUrl.extractFromUrl,
    importPuzzleImage: api.catalog.importPuzzleImage.importPuzzleImage,
    createPuzzle: api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    updatePuzzle: api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
    approve: api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    reject: api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
    // Reversible admin lifecycle on an approved definition (audit-stamped; nothing deleted).
    disable: api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
    reenable: api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
    // Community change proposals against approved definitions: any member proposes a field
    // diff; the proposer edits/withdraws their pending one; admins decide from the queue.
    proposeChange: api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    editChangeProposal: api.catalog.editChangeProposal.editChangeProposal,
    withdrawChangeProposal:
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
    approveChangeProposal:
      api.catalog.approveChangeProposal.approveChangeProposal,
    rejectChangeProposal: api.catalog.rejectChangeProposal.rejectChangeProposal,
    listMyChangeProposals:
      api.catalog.listMyChangeProposals.listMyChangeProposals,
    // Reads go through the domain-driven catalog module (file.export namespacing); each is a thin
    // Convex query returning a typed @jigswap/contracts view DTO, not a raw row. Public
    // lists/suggestions already filter to approved definitions only.
    puzzleById: api.catalog.getPuzzleById.getPuzzleById,
    listAll: api.catalog.listAllPuzzles.listAllPuzzles,
    recentPuzzles: api.catalog.getRecentPuzzles.getRecentPuzzles,
    pending:
      api.catalog.listPendingPuzzleDefinitions.listPendingPuzzleDefinitions,
    // The current member's own not-yet-approved submissions, so the add-copy picker can offer
    // a copy of a puzzle they contributed before it is approved.
    myContributedPuzzles:
      api.catalog.listMyContributedPuzzles.listMyContributedPuzzles,
    // Favorites: the member's own hearts on catalog definitions. The member is derived from auth
    // server-side; toggleFavorite flips the state, myFavoritePuzzleIds is the batch isFavorite
    // read (one subscription drives every heart), listMyFavorites returns summary DTOs for cards.
    toggleFavorite: api.catalog.toggleFavorite.toggleFavorite,
    myFavoritePuzzleIds: api.catalog.myFavoritePuzzleIds.myFavoritePuzzleIds,
    listMyFavorites: api.catalog.listMyFavorites.listMyFavorites,
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
    // Owner-only photo upload keyed by the copy's Convex id; pairs with generateUploadUrl. Writes
    // the `ownedPuzzleImages` read-model the getCopyInstanceView gallery reads.
    addCopyPhoto: api.library.addCopyPhoto.addCopyPhoto,
    // Owner-only removal of an uploaded copy photo (deletes the row + blob, clears the cover if it
    // was the cover). Keyed by the ownedPuzzleImages id.
    removeCopyPhoto: api.library.removeCopyPhoto.removeCopyPhoto,
    // Owner-only per-copy cover selection: pick one of the copy's photos, or clear to the global
    // image. Keyed by the copy's Convex id (like addCopyPhoto / getCopyInstanceView).
    setCopyCover: api.library.setCopyCover.setCopyCover,
    deleteOwned: api.library.deleteCopy.deleteCopy,
    // Reads go through the domain-driven library module (file.export namespacing); each is a thin
    // Convex query returning a typed @jigswap/contracts view DTO, not a raw row.
    ownedByOwner: api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
    // Browse reads from the Library inventory (owned copies), not the Catalog.
    browseOwned: api.library.browseOwnedPuzzles.browseOwnedPuzzles,
    ownedWithCollectionStatus:
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
    // Privacy-gated detail of a single owned copy: snapshot + projected owner + merged, anonymised
    // history timeline (transfers/completions/loans) split into the viewer's tenure vs gated history.
    getCopyInstanceView: api.library.getCopyInstanceView.getCopyInstanceView,
    // Redesigned catalog detail of a puzzle DEFINITION: catalog facts + community rating
    // distribution + ownership/completion/availability stats + the viewer's own ownership + a short
    // list of REACHABLE available copies (Browse's public-OR-circle gate).
    getPuzzleDefinitionView:
      api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
    // Per-photo discussion comments for the gallery lightbox, keyed by the `ownedPuzzleImages` _id.
    // Text-only (no rating); anyone authenticated may post and authors are shown with their real
    // identity. Photo metadata itself flows through getCopyInstanceView's gallery.
    postPhotoComment: api.library.postPhotoComment.postPhotoComment,
    listPhotoComments: api.library.listPhotoComments.listPhotoComments,
    // Image upload is storage infra, not a domain op; keep it on the legacy function. The URL is
    // used for copy photos.
    generateUploadUrl: api.puzzles.generateUploadUrl,
  },

  // Lending: open-ended loans of a copy's POSSESSION (ownership stays with the lender). A lend
  // exchange opens a loan on settlement; the borrower returns or the owner recalls.
  lending: {
    returnLoan: api.library.returnLoan.returnLoan,
    recallLoan: api.library.recallLoan.recallLoan,
    borrowed: api.library.getBorrowedLoans.getBorrowedLoans,
    lentOut: api.library.getLentOutLoans.getLentOutLoans,
    copyHistory: api.library.getCopyLoanHistory.getCopyLoanHistory,
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

  // Exchange (Trading): proposing and settling exchanges. Messaging on an exchange lives in the
  // Conversation namespace below (the legacy per-exchange chat was backfilled into threads).
  // Writes go through the domain-driven exchange module (file.export namespacing);
  // these enforce party-auth and legal transitions in the aggregate.
  exchange: {
    create: api.exchange.propose.propose,
    // Reads go through thin Convex adapters that return typed view DTOs from @jigswap/contracts
    // (ExchangeView / ExchangeSummaryView / ExchangeStatsView) rather than raw rows;
    // party-visibility, ordering and the joins are preserved so the UI is unchanged.
    byId: api.exchange.getExchangeById.getExchangeById,
    forUser: api.exchange.getUserExchanges.getUserExchanges,
    incoming: api.exchange.getExchangesByOwner.getExchangesByOwner,
    outgoing: api.exchange.getExchangesByRequester.getExchangesByRequester,
    accept: api.exchange.accept.accept,
    decline: api.exchange.decline.decline,
    complete: api.exchange.confirmCompletion.confirmCompletion,
    cancel: api.exchange.cancel.cancel,
    dispute: api.exchange.raiseDispute.raiseDispute,
    stats: api.exchange.getExchangeStats.getExchangeStats,
  },

  // Conversation: threads, DMs, exchange chat, inbox.
  conversation: {
    openDmThread: api.conversation.openDmThread.openDmThread,
    postMessage: api.conversation.postMessage.postMessage,
    markThreadRead: api.conversation.markThreadRead.markThreadRead,
    getMyInbox: api.conversation.getMyInbox.getMyInbox,
    getThreadMessages: api.conversation.getThreadMessages.getThreadMessages,
    getThreadByExchange:
      api.conversation.getThreadByExchange.getThreadByExchange,
    canMessage: api.conversation.canMessage.canMessage,
    getUnreadTotal: api.conversation.getUnreadTotal.getUnreadTotal,
  },

  // Chain-of-Custody: a Copy's provenance (original owner -> each settled transfer -> current
  // owner), read from the custody projection folded off Exchange's OwnershipTransferred events.
  custody: {
    timeline: api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
  },

  // Identity & Access: the wrapper over Clerk members and their profiles.
  identity: {
    // Reads go through thin Convex adapters returning typed view DTOs (MemberView / MemberStatsView)
    // from @jigswap/contracts; auth gating and lookups are preserved so the UI is unchanged.
    currentUser: api.identity.getCurrentUser.getCurrentUser,
    byClerkId: api.identity.getUserByClerkId.getUserByClerkId,
    byId: api.identity.getUserById.getUserById,
    // The write mutation stays on the legacy module (only reads are being cut over).
    updateProfile: api.users.updateUserProfile,
    userStats: api.identity.getUserStats.getUserStats,
    search: api.identity.searchUsers.searchUsers,
    // "Recently joined" seed for the Find-people tab: up to 5 newest PUBLIC members.
    recentPublicMembers:
      api.identity.listRecentPublicMembers.listRecentPublicMembers,
    // Whether the acting caller is an admin (fails closed). Backs the web /admin
    // route guard; the server-side gate on every admin function stays authoritative.
    isAdmin: api.identity.isCurrentUserAdmin.isCurrentUserAdmin,
    // Set (or clear, via null) the caller's Convex-owned profile handle.
    setSlug: api.identity.setSlug.setSlug,
  },

  // Solving: solve tracking, puzzle reviews, goals. Ownership / 24h edit window / rating are
  // enforced in the domain; reads surface server-derived state (photo URLs, goal isAchieved).
  solving: {
    recordCompletion: api.solving.recordCompletion.recordCompletion,
    finishCompletion: api.solving.finishCompletion.finishCompletion,
    editCompletion: api.solving.editCompletion.editCompletion,
    deleteCompletion: api.solving.deleteCompletion.deleteCompletion,
    reviewPuzzle: api.solving.reviewPuzzle.reviewPuzzle,
    createGoal: api.solving.createGoal.createGoal,
    myCompletions: api.solving.listMyCompletions.listMyCompletions,
    completionHistory: api.solving.getCompletionHistory.getCompletionHistory,
    myGoals: api.solving.listMyGoals.listMyGoals,
    setTrackCompletionDuration:
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
  },

  // Federated user settings: a read-composition over each context's settings section. Writes are
  // owned by the originating context (e.g. solving.setTrackCompletionDuration).
  settings: {
    mine: api.settings.getMyUserSettings.getMyUserSettings,
  },

  // Reputation: partner reviews after a completed Exchange + the per-member profile projection.
  // submitReview.exchangeId is the Exchange aggregateId; reviewee/member are user _ids (MemberId).
  reputation: {
    submitReview: api.reputation.submitPartnerReview.submitPartnerReview,
    profile: api.reputation.getReputationProfile.getReputationProfile,
    reviewsForMember: api.reputation.listReviewsForMember.listReviewsForMember,
    myReviewForExchange:
      api.reputation.getMyReviewForExchange.getMyReviewForExchange,
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
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
    // Native Web Push: the client reads the (non-secret) VAPID public key, then registers /
    // unregisters its PushManager subscription as the member toggles push.
    pushConfig: api.notifications.getPushConfig.getPushConfig,
    registerPush: api.notifications.pushSubscriptions.registerPushSubscription,
    unregisterPush:
      api.notifications.pushSubscriptions.unregisterPushSubscription,
  },

  // Community / Social: public profiles, follow relationships, and the activity feed. Writes go
  // through the domain-driven social module (file.export namespacing); the follower/member is
  // derived from auth, never the client. Reads return typed @jigswap/contracts view DTOs.
  social: {
    editProfile: api.social.editProfile.editProfile,
    setProfileVisibility: api.social.setProfileVisibility.setProfileVisibility,
    // Profile shelf curation: arrange the ordered set of owned copies shown on the profile plank.
    // Only the owner can call this (server enforces ownership of every copy). featuredShelf is
    // the read side — returns the curated copies in order, or [] when uncurated (fallback to
    // recent-6 is the caller's responsibility).
    arrangeShelf: api.social.arrangeShelf.arrangeShelf,
    featuredShelf: api.social.featuredShelf.featuredShelf,
    follow: api.social.followMember.followMember,
    unfollow: api.social.unfollowMember.unfollowMember,
    // Invite links / QR growth loop (Phase 3). getInviteContext + recordInviteLanding are PUBLIC
    // (unauthenticated landings); the rest require the acting member.
    myInviteLink: api.social.getMyInviteLink.getMyInviteLink,
    resetInviteLink: api.social.resetInviteLink.resetInviteLink,
    inviteContext: api.social.getInviteContext.getInviteContext,
    recordInviteLanding: api.social.recordInviteLanding.recordInviteLanding,
    redeemInvite: api.social.redeemInvite.redeemInvite,
    acceptQrFollow: api.social.acceptQrFollow.acceptQrFollow,
    profile: api.social.getProfile.getProfile,
    publicMemberTeaser: api.social.getPublicMemberTeaser.getPublicMemberTeaser,
    // The visibility-gated read behind the redesigned public member profile page. Unauthenticated-
    // capable; returns a discriminated { locked } payload (see PublicProfileView).
    publicProfile: api.social.getPublicProfile.getPublicProfile,
    followers: api.social.listFollowers.listFollowers,
    following: api.social.listFollowees.listFollowees,
    isFollowing: api.social.isFollowing.isFollowing,
    // "Followers you know" social proof for a member's profile — the viewer's own following
    // intersected with the target's followers (see social/knownFollowers.ts). Personalized.
    followersYouKnow: api.social.followersYouKnow.followersYouKnow,
    followRelation: api.social.getFollowRelation.getFollowRelation,
    approveFollowRequest: api.social.approveFollowRequest.approveFollowRequest,
    declineFollowRequest: api.social.declineFollowRequest.declineFollowRequest,
    cancelFollowRequest: api.social.cancelFollowRequest.cancelFollowRequest,
    incomingFollowRequests:
      api.social.listIncomingFollowRequests.listIncomingFollowRequests,
    // The feed is scoped server-side to the acting member + the people they follow.
    activityFeed: api.social.getActivityFeed.getActivityFeed,
    // Community comments on a puzzle definition, keyed by a copy id for the UI's convenience
    // (resolved to the shared puzzle internally). Authors are shown with their real identity.
    postPuzzleComment: api.social.postPuzzleComment.postPuzzleComment,
    listPuzzleComments: api.social.listPuzzleComments.listPuzzleComments,
    // Community reviews keyed by the puzzle DEFINITION (the catalog detail page has no copy id).
    // Same `puzzleComments` table + post-comment use case as the copy-keyed variants above.
    postPuzzleReview: api.social.postPuzzleReview.postPuzzleReview,
    listPuzzleReviews: api.social.listPuzzleReviews.listPuzzleReviews,
  },

  // Insights: read-side aggregate stats. globalStats is platform-wide; the rest are the signed-in
  // member's own analytics (personal stats, trends, breakdowns) plus a self-service data export.
  insights: {
    // Thin adapter returning the GlobalStatsView DTO; counts are identical to the legacy query.
    globalStats: api.insights.getGlobalStats.getGlobalStats,
    personalStats: api.insights.getPersonalStats.getPersonalStats,
    completionTrends: api.insights.getCompletionTrends.getCompletionTrends,
    collectionBreakdown:
      api.insights.getCollectionBreakdown.getCollectionBreakdown,
    tradeActivity: api.insights.getTradeActivity.getTradeActivity,
    // Downstream read-model: ranks approved catalog puzzles the member doesn't own from their taste.
    recommendations: api.insights.getRecommendations.getRecommendations,
    exportUserData: api.insights.exportUserData.exportUserData,
    // Public query — returns a random seed-stable sample of catalog puzzles for
    // the marketing hero plank. Args: { limit: number; seed: number }.
    plankPuzzles: api.insights.getPlankPuzzles.getPlankPuzzles,
    // Public query — returns a seed-stable sample of active members (initials +
    // opt-in avatar URL) for the marketing trust-row avatar cluster.
    communityAvatars: api.insights.getCommunityAvatars.getCommunityAvatars,
  },

  // Public marketing contact form: operational/support write, not a bounded context. The thin
  // mutation is unauthenticated and persists the message for admin triage.
  contact: {
    submit: api.contact.submitContactMessage.submitContactMessage,
  },

  // Public docs feedback: operational/support write from the marketing /docs site. The thin
  // mutation is unauthenticated and persists the "Was this page helpful?" vote for admin review.
  docs: {
    submitFeedback: api.docs.submitDocFeedback.submitDocFeedback,
  },

  // Friend Circles (Sharing): private groups whose members share circle-scoped visibility. Writes
  // go through the domain-driven sharing module (file.export namespacing); membership ops are
  // admin-gated in the Circle aggregate. `circleId` is the CircleId aggregateId; `copyId` is the
  // Library CopyId. Reads return typed @jigswap/contracts circle view DTOs.
  sharing: {
    createCircle: api.sharing.createCircle.createCircle,
    addMember: api.sharing.addMember.addMember,
    removeMember: api.sharing.removeMember.removeMember,
    changePermission: api.sharing.changePermission.changePermission,
    shareCopyToCircle: api.sharing.shareCopyToCircle.shareCopyToCircle,
    myCircles: api.sharing.listMyCircles.listMyCircles,
    circle: api.sharing.getCircle.getCircle,
  },

  // Global search: the single read behind the ⌘K command palette. One query returns a grouped,
  // navigation-ready result set across Puzzles (real catalog search index, approved-only), People
  // (bounded in-memory scan — no name index yet), the member's Circles, and the member's
  // Collections. Empty/short terms and unauthenticated callers return empty groups.
  search: {
    global: api.search.globalSearch.global,
  },

  // Moderation console: KPI/activity read models over the moderationActions audit
  // trail plus the flagged-photo review queue (auto-rejected copy photos an admin
  // restores or confirms). Every function is admin-gated server-side.
  admin: {
    getModerationStats: api.admin.getModerationStats.getModerationStats,
    getModerationActivity:
      api.admin.getModerationActivity.getModerationActivity,
    // Every catalog definition regardless of status, for the /admin/puzzles console.
    listPuzzleDefinitions:
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
    // Per-definition admin detail read model: definition facts + submitter,
    // ownership stats, capped distinct-owners rollup, and the definition's
    // moderation trail (by_target on the Catalog aggregateId). Gated
    // server-side like listPuzzleDefinitions.
    getPuzzleDefinitionDetail:
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
    // Community change-proposal review: the pending queue (with derived conflict flags) and
    // the per-definition history for the detail page.
    listPendingChangeProposals:
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
    listProposalsForDefinition:
      api.catalog.listProposalsForDefinition.listProposalsForDefinition,
    // One proposal by id, any status — backs the review screen (renders read-only once decided).
    getChangeProposal: api.catalog.getChangeProposal.getChangeProposal,
    listRejectedPhotos: api.admin.listRejectedPhotos.listRejectedPhotos,
    restorePhoto: api.admin.restorePhoto.restorePhoto,
    confirmPhotoRemoval: api.admin.confirmPhotoRemoval.confirmPhotoRemoval,
    // Admin users directory (read-only v1 — no user actions). Paginated; an optional
    // `search` arg switches to the by_searchable_name index. Rows are AdminUserView
    // DTOs whose `role` is the display-only Clerk mirror (authz stays JWT-based).
    listUsers: api.admin.listUsers.listUsers,
    // Per-member admin detail read model: full profile (email + clerkId —
    // admin-only by design), indexed library/activity stats, capped catalog
    // submissions, and the capped moderation audit trail (performed via
    // by_actor / received via by_target). Gated server-side like listUsers;
    // profile.role stays the display-only Clerk mirror.
    getUserDetail: api.admin.getUserDetail.getUserDetail,
    // Role management WRITE path: a "use node" ACTION (Clerk network write), not
    // a mutation — call it with useConvexAction (the extractPuzzleFromUrl
    // pattern). Grants/revokes the Clerk publicMetadata.role (the authz source
    // of truth), fast-paths the users.role display mirror and stamps a
    // role_granted/role_revoked audit row. Self-changes are refused server-side.
    setUserRole: api.admin.setUserRole.setUserRole,
  },

  // Admin triage: the operational/support inboxes written by the public contact
  // form and docs-feedback widget. Reads and the handled-transition are admin-only
  // (enforced server-side in the Convex functions).
  adminTriage: {
    contactMessages: api.contact.listContactMessages.listContactMessages,
    markContactHandled:
      api.contact.markContactMessageHandled.markContactMessageHandled,
    docFeedback: api.docs.listDocFeedback.listDocFeedback,
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
