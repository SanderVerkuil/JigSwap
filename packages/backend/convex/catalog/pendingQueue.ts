// The most rows an admin review queue reads at once (catalog/listPendingPuzzleDefinitions,
// catalog/listPendingChangeProposals), newest first. Each row costs further reads to enrich, and a
// flood of submissions must not fail the read the admin needs to deal with it (SEC-26). The queue's
// real size is in admin/pendingCounts, which says when it has stopped counting.
export const PENDING_QUEUE_LIMIT = 200;
