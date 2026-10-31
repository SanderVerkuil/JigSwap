import { v } from "convex/values";

// Hash-check bookkeeping on every image table (schema), and the publication gate built on it.
//
// - `hashCheckPendingSince`: set when the upload is inserted (and kept while the hash service is
//   unreachable); cleared once the CSAM hash check returns no_match, once the check is skipped
//   (below), once the pipeline refused the upload and its blob is gone, or once the photo is
//   quarantined (a match: it waits on nothing, and its gate stays closed by its status). A
//   timed-out photo an admin rejected keeps it: it is what keeps that photo's gate closed should
//   it ever be restored (admin/restorePhoto).
// - `hashCheckedAt`: when the publication gate OPENED, which is not always a hash check: the
//   check returned no_match, or an admin approved the photo after its check timed out
//   (`hashCheckWaivedBy`), or no hash matching was configured (`hashCheckSkippedAt`). Only a row
//   with `hashCheckedAt` and neither marker has passed a hash check.
// - `hashCheckSkippedAt`: when the pipeline published the photo WITHOUT a hash check because none
//   is configured on the deployment (csamHashCheck.skipsHashCheck: provider "none", or
//   "offlimits" with a credential missing). Nothing ever records such a photo as checked: it
//   keeps its `pendingHashes`, so the one-shot lib/imageModeration/recheckWaivedHashes can check
//   it once matching is configured. Cleared, with `pendingHashes`, when a check returns
//   no_match; a match quarantines it (a quarantined row keeps the marker: it was served
//   unchecked until the match). Photos published before this marker existed carry nothing: their
//   hashes were never kept, so they cannot be checked later.
// - `pendingHashes`: MD5 + SHA-1 of the original and the re-encode, kept while the check is
//   "unavailable" so it can be retried after the original is gone (lib/imageModeration), after
//   an admin approved a timed-out photo (below), and on a photo published unchecked (above).
// - `hashRecheckAttempt` / `hashRecheckDueAt`: the one re-check of those hashes that is current
//   (1-based) and when it is due (lib/imageModeration/hashRecheckPool). A re-check job whose
//   attempt is not the row's is stale and does nothing.
// - `hashCheckTimedOutAt`: when the scheduled re-checks stopped because the photo had waited
//   HASH_CHECK_TIMEOUT_MS (hashRecheckPool). The photo stays unpublished and goes to the admin
//   queue (admin/listUncheckedPhotos), where an admin approves or rejects it.
// - `hashCheckWaivedBy`: the admin who approved a timed-out photo WITHOUT a hash check
//   (admin/decideUncheckedPhoto). That approval sets `hashCheckedAt` (it opens the gate) but keeps
//   `pendingHashes`, so a re-check that still runs can match and quarantine it: a match always
//   wins, an admin approval included (lib/imageModeration/pipeline.runHashRecheck). Cleared, with
//   `pendingHashes`, once a hash check returns no_match after all (the one-shot
//   lib/imageModeration/recheckWaivedHashes): the photo is then hash-checked like any other.
//
// GATE: no read model issues a storage URL for a row until its hash check has passed. Convex
// storage URLs do not expire, so a URL handed out before a match would keep serving the image.
// Rows from before the gate existed carry neither field and keep being served as before. A
// quarantined row is never cleared, whatever its fields say: a re-check that matches a photo whose
// gate was already open (an admin waiver) leaves `hashCheckedAt` set, and its fileId now points at
// the CSAM escalation's preserved blob.

export const imageHashPair = v.object({ md5: v.string(), sha1: v.string() });

export const hashCheckFields = {
  hashCheckedAt: v.optional(v.number()),
  hashCheckPendingSince: v.optional(v.number()),
  pendingHashes: v.optional(v.array(imageHashPair)),
  hashRecheckAttempt: v.optional(v.number()),
  hashRecheckDueAt: v.optional(v.number()),
  hashCheckTimedOutAt: v.optional(v.number()),
  hashCheckWaivedBy: v.optional(v.id("users")),
  hashCheckSkippedAt: v.optional(v.number()),
};

/**
 * Whether the row's hash check has passed (or the row predates the gate): it may be served. Never
 * for a quarantined row (a CSAM hash match), even one whose gate had opened before the match.
 */
export const isHashCleared = (row: {
  hashCheckedAt?: number;
  hashCheckPendingSince?: number;
  moderationStatus?: string;
}): boolean =>
  row.moderationStatus !== "quarantined" &&
  (row.hashCheckedAt !== undefined || row.hashCheckPendingSince === undefined);

/**
 * Whether the photo's hash check timed out and is still undecided: its re-checks stopped, it is
 * unpublished, and only an admin can release it (admin/decideUncheckedPhoto).
 */
export const isHashCheckTimedOut = (row: {
  hashCheckedAt?: number;
  hashCheckTimedOutAt?: number;
}): boolean =>
  row.hashCheckTimedOutAt !== undefined && row.hashCheckedAt === undefined;

/**
 * Whether the photo was published WITHOUT a hash check (an admin waived it after a timeout, or no
 * hash matching was configured: `hashCheckSkippedAt`) and its stored hashes still wait for that
 * check: the one-shot lib/imageModeration/recheckWaivedHashes checks them once the hash service is
 * configured. A no_match clears the marker and the hashes, a match quarantines the photo, so
 * neither is a candidate again.
 */
export const isWaivedHashRecheckCandidate = (row: {
  hashCheckWaivedBy?: unknown;
  hashCheckSkippedAt?: number;
  pendingHashes?: unknown;
  moderationStatus?: string;
}): boolean =>
  (row.hashCheckWaivedBy !== undefined ||
    row.hashCheckSkippedAt !== undefined) &&
  row.pendingHashes !== undefined &&
  row.moderationStatus !== "quarantined";
