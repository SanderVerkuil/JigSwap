import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

// What can hold a stored blob. A held blob is never claimed by an upload flow (message photo
// staging, a circle icon, the box-art strip) and its holder decides when it goes, so a storage id
// someone learned can neither be taken over nor destroyed through another row.
export type BlobReferenceKind =
  | "copyPhoto" // ownedPuzzleImages.fileId
  | "completionPhoto" // completionImages.fileId (the sidecar of a completions.photos entry)
  | "messagePhoto" // messageAttachments.fileId
  | "messageThumb" // messageAttachments.thumbFileId
  | "locationMap" // messageAttachments.mapFileId
  | "circleIcon" // circleIcons.fileId
  | "definitionBoxArt" // puzzles.image
  | "proposedBoxArt" // puzzleChangeProposals.changes.image
  | "boxArtListing" // boxArtUploads.storageId: checked box art, attached or not (yet)
  | "reportEvidence" // reports.evidenceFileId
  | "preserved"; // csamEscalations.fileId: kept for the escalation, never deleted by the app

type Holder = { _id: string };

// One indexed lookup per kind. `take(2)`: with one row excepted, a second still tells whether
// anything else holds the blob.
const LOOKUPS: Record<
  BlobReferenceKind,
  (ctx: QueryCtx, id: Id<"_storage">) => Promise<Holder[]>
> = {
  copyPhoto: (ctx, id) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(2),
  completionPhoto: (ctx, id) =>
    ctx.db
      .query("completionImages")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(2),
  messagePhoto: (ctx, id) =>
    ctx.db
      .query("messageAttachments")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(2),
  messageThumb: (ctx, id) =>
    ctx.db
      .query("messageAttachments")
      .withIndex("by_thumb_file", (q) => q.eq("thumbFileId", id))
      .take(2),
  locationMap: (ctx, id) =>
    ctx.db
      .query("messageAttachments")
      .withIndex("by_map_file", (q) => q.eq("mapFileId", id))
      .take(2),
  circleIcon: (ctx, id) =>
    ctx.db
      .query("circleIcons")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(2),
  definitionBoxArt: (ctx, id) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", id))
      .take(2),
  proposedBoxArt: (ctx, id) =>
    ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_changes_image", (q) => q.eq("changes.image", id as string))
      .take(2),
  boxArtListing: (ctx, id) =>
    ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .take(2),
  reportEvidence: (ctx, id) =>
    ctx.db
      .query("reports")
      .withIndex("by_evidence_file", (q) => q.eq("evidenceFileId", id))
      .take(2),
  preserved: (ctx, id) =>
    ctx.db
      .query("csamEscalations")
      .withIndex("by_file", (q) => q.eq("fileId", id))
      .take(2),
};

const KINDS = Object.keys(LOOKUPS) as BlobReferenceKind[];

// Whether a row of this kind other than `except` (a row id of any table) holds the blob.
const heldBy = async (
  ctx: QueryCtx,
  kind: BlobReferenceKind,
  storageId: Id<"_storage">,
  except: string | undefined,
): Promise<boolean> =>
  (await LOOKUPS[kind](ctx, storageId)).some((row) => row._id !== except);

/**
 * Every kind of row that holds the blob, leaving out the row `except` (the one a delete path is
 * removing, or the one the pipeline is moving to a new blob). Empty when nothing else holds it.
 *
 * Deliberately NOT references (string-typed, compared or cached only, never served):
 * `puzzleChangeProposals.baseline.image` (the definition's image when the proposal was made) and
 * `ownedPuzzles.snapshot.thumbnail` (a cache of `puzzles.image`). Known residual: a legacy
 * completion photo that predates its completionImages sidecar lives only in the unindexable
 * `completions.photos` array until solving/backfillLegacyCompletionSidecars gives it one (a
 * completion without an aggregateId never can; that run counts them). blobReferences.test.ts
 * fails when the schema gains a
 * `v.id("_storage")` field that is not registered here.
 */
export const blobReferenceKinds = async (
  ctx: QueryCtx,
  storageId: Id<"_storage">,
  { except }: { except?: string } = {},
): Promise<Set<BlobReferenceKind>> => {
  const kinds = new Set<BlobReferenceKind>();
  for (const kind of KINDS) {
    if (await heldBy(ctx, kind, storageId, except)) kinds.add(kind);
  }
  return kinds;
};

/** Whether anything but `except` holds the blob (blobReferenceKinds is not empty). */
export const isReferenced = async (
  ctx: QueryCtx,
  storageId: Id<"_storage">,
  { except }: { except?: string } = {},
): Promise<boolean> => {
  for (const kind of KINDS) {
    if (await heldBy(ctx, kind, storageId, except)) return true;
  }
  return false;
};
