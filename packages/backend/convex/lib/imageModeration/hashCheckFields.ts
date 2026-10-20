import { v } from "convex/values";

// Hash-check bookkeeping on every image table (schema), and the publication gate built on it.
//
// - `hashCheckPendingSince`: set when the upload is inserted (and kept while the hash service is
//   unreachable); cleared once the CSAM hash check returns no_match.
// - `hashCheckedAt`: when the hash check returned no_match (with provider "none": as soon as the
//   pipeline runs), or when an admin approved the photo after its hash check timed out.
// - `pendingHashes`: MD5 + SHA-1 of the original and the re-encode, kept only while the check is
//   "unavailable" so it can be retried after the original is gone (lib/imageModeration), and
//   after an admin approved a timed-out photo (below).
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
// Rows from before the gate existed carry neither field and keep being served as before.

export const imageHashPair = v.object({ md5: v.string(), sha1: v.string() });

export const hashCheckFields = {
  hashCheckedAt: v.optional(v.number()),
  hashCheckPendingSince: v.optional(v.number()),
  pendingHashes: v.optional(v.array(imageHashPair)),
  hashRecheckAttempt: v.optional(v.number()),
  hashRecheckDueAt: v.optional(v.number()),
  hashCheckTimedOutAt: v.optional(v.number()),
  hashCheckWaivedBy: v.optional(v.id("users")),
};

/** Whether the row's hash check has passed (or the row predates the gate): it may be served. */
export const isHashCleared = (row: {
  hashCheckedAt?: number;
  hashCheckPendingSince?: number;
}): boolean =>
  row.hashCheckedAt !== undefined || row.hashCheckPendingSince === undefined;

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
 * Whether the photo was approved WITHOUT a hash check (an admin waived it after a timeout) and its
 * stored hashes still wait for that check: the one-shot lib/imageModeration/recheckWaivedHashes
 * checks them once the hash service is configured. A no_match clears both fields, a match
 * quarantines the photo, so neither is a candidate again.
 */
export const isWaivedHashRecheckCandidate = (row: {
  hashCheckWaivedBy?: unknown;
  pendingHashes?: unknown;
  moderationStatus?: string;
}): boolean =>
  row.hashCheckWaivedBy !== undefined &&
  row.pendingHashes !== undefined &&
  row.moderationStatus !== "quarantined";
