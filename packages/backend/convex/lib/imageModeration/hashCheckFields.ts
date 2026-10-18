import { v } from "convex/values";

// Hash-check bookkeeping on every image table (schema), and the publication gate built on it.
//
// - `hashCheckPendingSince`: set when the upload is inserted (and kept while the hash service is
//   unreachable); cleared once the CSAM hash check returns no_match.
// - `hashCheckedAt`: when the hash check returned no_match (with provider "none": as soon as the
//   pipeline runs).
// - `pendingHashes`: MD5 + SHA-1 of the original and the re-encode, kept only while the check is
//   "unavailable" so it can be retried after the original is gone (lib/imageModeration).
//
// GATE: no read model issues a storage URL for a row until its hash check has passed. Convex
// storage URLs do not expire, so a URL handed out before a match would keep serving the image.
// Rows from before the gate existed carry neither field and keep being served as before.

export const imageHashPair = v.object({ md5: v.string(), sha1: v.string() });

export const hashCheckFields = {
  hashCheckedAt: v.optional(v.number()),
  hashCheckPendingSince: v.optional(v.number()),
  pendingHashes: v.optional(v.array(imageHashPair)),
};

/** Whether the row's hash check has passed (or the row predates the gate): it may be served. */
export const isHashCleared = (row: {
  hashCheckedAt?: number;
  hashCheckPendingSince?: number;
}): boolean =>
  row.hashCheckedAt !== undefined || row.hashCheckPendingSince === undefined;
