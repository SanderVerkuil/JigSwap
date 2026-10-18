import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { stampModerationAction } from "../../admin/stampModerationAction";
import { imageHashPair } from "./hashCheckFields";

// Table-agnostic side of a CSAM hash match (lib/imageModeration/csamHashCheck). Each image
// table's store module flips its own row to "quarantined" (and detaches it wherever else the
// table references the blob), then calls `recordCsamEscalation`. The escalation is ALWAYS
// recorded, even when the row changed or vanished while the check ran: the pipeline stores the
// matched bytes again as a NEW blob first, so the evidence never depends on the row.
//
// Policy on a match:
// - never deliver: the row is "quarantined", which every read path treats as not shown, and no
//   read model returns its URL, storage id or blurhash, to anyone (admins included);
// - preserve: the matched bytes are stored again as a NEW blob, which never had a URL, and the
//   uploaded blob (whose URL might have been issued) is deleted. The new blob is NOT deleted. Whether and how long to keep it is a legal question the
//   operator settles per law-enforcement instruction, so the app never deletes a blob that an
//   escalation references (`isPreservedBlob`);
// - escalate: one csamEscalations row (hashes, match, timestamps; no image) for the operator to
//   report to Meldpunt Offlimits or the police, plus an `image_quarantined` audit stamp.
//
// NO NOTIFICATION TO THE UPLOADER, deliberately. A statement of reasons (DSA Art. 17) would tell
// a suspect that known abuse material was recognised and so risks tipping them off and harming a
// criminal investigation; reporting to the authorities (DSA Art. 18, and the Dutch reporting
// route via Meldpunt Offlimits) comes first. The photo simply never appears, exactly like a
// rejected one. [LAWYER] A lawyer should confirm this reading of Art. 17/18, and whether a
// statement must follow later (for example once law enforcement agrees).

export type QuarantinedTable =
  "ownedPuzzleImages" | "completionImages" | "messageAttachments";

// Audit-trail label per table: no puzzle title or other content, just which kind of photo.
const TABLE_LABEL: Record<QuarantinedTable, string> = {
  ownedPuzzleImages: "Copy photo",
  completionImages: "Completion photo",
  messageAttachments: "Message photo",
};

/** Insert the escalation row and stamp `image_quarantined` (no actor: the automated pipeline). */
export const recordCsamEscalation = async (
  ctx: MutationCtx,
  args: {
    table: QuarantinedTable;
    rowId: string;
    uploaderId: Id<"users">;
    fileId?: Id<"_storage">;
    md5: string;
    sha1: string;
    provider: string;
    originalDiscarded: boolean;
  },
): Promise<Id<"csamEscalations">> => {
  // One escalation per preserved blob: a row re-pointed at an already-preserved blob (see
  // getPreservedHashes) joins the existing escalation instead of raising a second one.
  const fileId = args.fileId;
  const existing = fileId
    ? await ctx.db
        .query("csamEscalations")
        .withIndex("by_file", (q) => q.eq("fileId", fileId))
        .first()
    : null;
  if (existing) return existing._id;
  // Snapshot the uploader's identity now: the report must survive account deletion.
  const uploader = await ctx.db.get(args.uploaderId);
  const escalationId = await ctx.db.insert("csamEscalations", {
    ...args,
    ...(uploader
      ? {
          uploaderSnapshot: {
            clerkId: uploader.clerkId,
            email: uploader.email,
            name: uploader.name,
            username: uploader.username,
          },
        }
      : {}),
    matchedAt: Date.now(),
    status: "open",
  });
  await stampModerationAction(ctx, {
    kind: "image_quarantined",
    targetLabel: TABLE_LABEL[args.table],
    targetId: escalationId,
  });
  return escalationId;
};

/** Whether a blob is preserved for an escalation (and so must never be deleted by the app). */
export const isPreservedBlob = async (
  ctx: QueryCtx,
  fileId: Id<"_storage">,
): Promise<boolean> =>
  (await ctx.db
    .query("csamEscalations")
    .withIndex("by_file", (q) => q.eq("fileId", fileId))
    .first()) !== null;

// For the Node pipeline (no ctx.db): the matched hashes when a blob is already preserved for an
// escalation (a row that references it is quarantined at once), else null.
export const getPreservedHashes = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const escalation = await ctx.db
      .query("csamEscalations")
      .withIndex("by_file", (q) => q.eq("fileId", storageId))
      .first();
    return escalation ? { md5: escalation.md5, sha1: escalation.sha1 } : null;
  },
});

// For the Node pipeline (no ctx.db): check before deleting an original blob.
export const isBlobPreserved = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: (ctx, { storageId }) => isPreservedBlob(ctx, storageId),
});

/**
 * The args every table's `quarantineImage` store mutation takes from the pipeline: the new
 * preserved blob, the uploader (the row may be gone by now), the matched hashes, the provider,
 * and whether the original upload had already been discarded (a match on re-check).
 */
export const quarantineArgs = {
  // Absent only when a re-check matched after the row's blob was already gone.
  fileId: v.optional(v.id("_storage")),
  uploaderId: v.id("users"),
  md5: v.string(),
  sha1: v.string(),
  provider: v.string(),
  originalDiscarded: v.boolean(),
};

/** The args every table's `setHashCheck` store mutation takes from the pipeline. */
export const hashCheckResultArgs = {
  status: v.union(v.literal("no_match"), v.literal("unavailable")),
  hashes: v.optional(v.array(imageHashPair)),
};

/**
 * Record a hash-check outcome on a row: no_match clears the publication gate; unavailable keeps
 * it closed and stores the hashes for a later re-check. A quarantined row is left alone.
 */
export const applyHashCheckResult = async (
  ctx: MutationCtx,
  imageId:
    Id<"ownedPuzzleImages"> | Id<"completionImages"> | Id<"messageAttachments">,
  result: {
    status: "no_match" | "unavailable";
    hashes?: { md5: string; sha1: string }[];
  },
) => {
  const row = await ctx.db.get(imageId);
  if (!row || row.moderationStatus === "quarantined") return;
  if (result.status === "no_match") {
    await ctx.db.patch(imageId, {
      hashCheckedAt: Date.now(),
      hashCheckPendingSince: undefined,
      pendingHashes: undefined,
    });
    return;
  }
  await ctx.db.patch(imageId, {
    hashCheckPendingSince: row.hashCheckPendingSince ?? Date.now(),
    pendingHashes: result.hashes,
  });
};
