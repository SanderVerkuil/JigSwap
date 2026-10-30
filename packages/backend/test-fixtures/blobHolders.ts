import type { TestConvex } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import type { BlobReferenceKind } from "../convex/lib/imageModeration/blobReferences";
import type schema from "../convex/schema";

// One holder row per blob-reference kind (lib/imageModeration/blobReferences), shared by the tests
// that must cover every kind: blobReferences.test.ts and storageSweep.test.ts.

type T = TestConvex<typeof schema>;

export const storeBlob = (t: T) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/png" }),
      ) as Promise<Id<"_storage">>,
  );

const seedRows = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const member = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: member,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: member,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { member, puzzleId, copy };
  });

/** A member, a definition without box art and a copy, plus a spare blob. */
export const seedBlobHolderBase = async (t: T) => ({
  ...(await seedRows(t)),
  // A second blob, for a row whose main file must not be the blob under test.
  spare: await storeBlob(t),
});

export type BlobHolderBase = Awaited<ReturnType<typeof seedBlobHolderBase>>;

// Typed as a Record over the kinds, so a new kind without a seed here fails type-check.
export const BLOB_HOLDER_SEEDS: Record<
  BlobReferenceKind,
  (
    ctx: MutationCtx,
    base: BlobHolderBase,
    blob: Id<"_storage">,
  ) => Promise<string>
> = {
  copyPhoto: (ctx, { member, copy }, blob) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: member,
      fileId: blob,
      createdAt: 0,
      updatedAt: 0,
    }),
  completionPhoto: (ctx, { member }, blob) =>
    ctx.db.insert("completionImages", {
      completionId: crypto.randomUUID(),
      uploaderId: member,
      fileId: blob,
      createdAt: 0,
      updatedAt: 0,
    }),
  messagePhoto: (ctx, { member }, blob) =>
    ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: "thread",
      uploaderId: member,
      fileId: blob,
      byteSize: 3,
      contentType: "image/png",
      moderationStatus: "approved",
      createdAt: 0,
      updatedAt: 0,
    }),
  // The photo itself is another blob: only the rendition is `blob`.
  messageThumb: (ctx, { member, spare }, blob) =>
    ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: "thread",
      uploaderId: member,
      fileId: spare,
      thumbFileId: blob,
      byteSize: 3,
      contentType: "image/png",
      moderationStatus: "approved",
      createdAt: 0,
      updatedAt: 0,
    }),
  locationMap: (ctx, { member }, blob) =>
    ctx.db.insert("messageAttachments", {
      kind: "location",
      threadAggregateId: "thread",
      uploaderId: member,
      precision: "exact",
      mapFileId: blob,
      mapStatus: "ready",
      createdAt: 0,
      updatedAt: 0,
    }),
  circleIcon: (ctx, { member }, blob) =>
    ctx.db.insert("circleIcons", {
      circleId: crypto.randomUUID(),
      uploaderId: member,
      fileId: blob,
      moderationStatus: "approved",
      createdAt: 0,
      updatedAt: 0,
    }),
  definitionBoxArt: (ctx, { member }, blob) =>
    ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Box art holder",
      pieceCount: 500,
      image: blob,
      status: "approved",
      submittedBy: member,
      createdAt: 0,
      updatedAt: 0,
    }),
  proposedBoxArt: (ctx, { member }, blob) =>
    ctx.db.insert("puzzleChangeProposals", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: crypto.randomUUID(),
      proposedBy: member,
      status: "pending",
      changes: { image: blob },
      baseline: {},
      createdAt: 0,
      updatedAt: 0,
    }),
  boxArtListing: (ctx, { member }, blob) =>
    ctx.db.insert("boxArtUploads", {
      storageId: blob,
      uploaderId: member,
      createdAt: 0,
    }),
  reportEvidence: (ctx, { member }, blob) =>
    ctx.db.insert("reports", {
      targetKind: "attachment",
      targetId: "attachment",
      reportedUserId: member,
      reason: "other",
      evidence: {},
      status: "actioned",
      evidenceFileId: blob,
      createdAt: 0,
    }),
  // The source is another blob: only the rendition is `blob`.
  renditionSmall: (ctx, { spare }, blob) =>
    ctx.db.insert("imageRenditions", {
      sourceId: spare,
      width: 2000,
      height: 1500,
      small: { fileId: blob, width: 480, height: 360 },
      createdAt: 0,
    }),
  renditionMedium: (ctx, { spare }, blob) =>
    ctx.db.insert("imageRenditions", {
      sourceId: spare,
      width: 2000,
      height: 1500,
      medium: { fileId: blob, width: 960, height: 720 },
      createdAt: 0,
    }),
  preserved: (ctx, { member }, blob) =>
    ctx.db.insert("csamEscalations", {
      table: "ownedPuzzleImages",
      rowId: "row",
      uploaderId: member,
      fileId: blob,
      md5: "md5",
      sha1: "sha1",
      provider: "offlimits",
      matchedAt: 0,
      status: "open",
    }),
};

export const BLOB_HOLDER_KINDS = Object.keys(
  BLOB_HOLDER_SEEDS,
) as BlobReferenceKind[];
