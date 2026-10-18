import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { stampModerationAction } from "../../admin/stampModerationAction";

// Table-agnostic side of a CSAM hash match (lib/imageModeration/csamHashCheck). Each image
// table's store module flips its own row to "quarantined" (and detaches it wherever else the
// table references the blob), then calls `recordCsamEscalation`.
//
// Policy on a match:
// - never deliver: the row is "quarantined", which every read path treats as not shown, and no
//   read model returns its URL, storage id or blurhash, to anyone (admins included);
// - preserve: the blob is NOT deleted. Whether and how long to keep it is a legal question the
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

export type QuarantinedTable = "ownedPuzzleImages" | "completionImages";

// Audit-trail label per table: no puzzle title or other content, just which kind of photo.
const TABLE_LABEL: Record<QuarantinedTable, string> = {
  ownedPuzzleImages: "Copy photo",
  completionImages: "Completion photo",
};

/** Insert the escalation row and stamp `image_quarantined` (no actor: the automated pipeline). */
export const recordCsamEscalation = async (
  ctx: MutationCtx,
  args: {
    table: QuarantinedTable;
    rowId: string;
    uploaderId: Id<"users">;
    fileId: Id<"_storage">;
    md5: string;
    sha1: string;
    provider: string;
  },
): Promise<Id<"csamEscalations">> => {
  const escalationId = await ctx.db.insert("csamEscalations", {
    ...args,
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

// For the Node pipeline (no ctx.db): check before deleting an original blob.
export const isBlobPreserved = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: (ctx, { storageId }) => isPreservedBlob(ctx, storageId),
});

/** The args every table's `quarantineImage` store mutation takes from the pipeline. */
export const quarantineArgs = {
  md5: v.string(),
  sha1: v.string(),
  provider: v.string(),
};
