import { convexTest, type TestConvex } from "convex-test";
import type { GenericValidator } from "convex/values";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  blobReferenceKinds,
  isReferenced,
  type BlobReferenceKind,
} from "./lib/imageModeration/blobReferences";
import schema from "./schema";

// SEC-92: every row that can hold a stored blob is seen by blobReferenceKinds (so claims refuse
// it and delete paths keep it), and the schema cannot gain a storage-id field nobody registered.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const storeBlob = (t: T) =>
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

const seedBase = async (t: T) => ({
  ...(await seedRows(t)),
  // A second blob, for a row whose main file must not be the blob under test.
  spare: await storeBlob(t),
});

type Base = Awaited<ReturnType<typeof seedBase>>;

// One holder row per kind. Typed as a Record over the kinds, so a new kind without a seed here
// fails type-check.
const SEEDS: Record<
  BlobReferenceKind,
  (ctx: MutationCtx, base: Base, blob: Id<"_storage">) => Promise<string>
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

const KINDS = Object.keys(SEEDS) as BlobReferenceKind[];

const kindsOf = (t: T, blob: Id<"_storage">, except?: string) =>
  t.run(async (ctx) => [...(await blobReferenceKinds(ctx, blob, { except }))]);

describe("blobReferenceKinds", () => {
  test("an unreferenced blob is held by nothing", async () => {
    const t = convexTest(schema, modules);
    await seedBase(t);
    const blob = await storeBlob(t);
    expect(await kindsOf(t, blob)).toEqual([]);
    expect(await t.run((ctx) => isReferenced(ctx, blob))).toBe(false);
  });

  test.each(KINDS)("a %s holds its blob", async (kind) => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const blob = await storeBlob(t);
    const other = await storeBlob(t);
    await t.run((ctx) => SEEDS[kind](ctx, base, blob));

    expect(await kindsOf(t, blob)).toEqual([kind]);
    expect(await t.run((ctx) => isReferenced(ctx, blob))).toBe(true);
    // Only that blob: an unrelated one stays unreferenced.
    expect(await kindsOf(t, other)).toEqual([]);
  });

  test("`except` leaves out exactly that row", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const blob = await storeBlob(t);
    const first = await t.run((ctx) => SEEDS.copyPhoto(ctx, base, blob));

    expect(await kindsOf(t, blob, first)).toEqual([]);
    expect(
      await t.run((ctx) => isReferenced(ctx, blob, { except: first })),
    ).toBe(false);

    // A second row of the same kind still holds it, and so does a row of another kind.
    const second = await t.run((ctx) => SEEDS.copyPhoto(ctx, base, blob));
    expect(await kindsOf(t, blob, first)).toEqual(["copyPhoto"]);
    await t.run((ctx) => ctx.db.delete(second as Id<"ownedPuzzleImages">));
    await t.run((ctx) => SEEDS.definitionBoxArt(ctx, base, blob));
    expect(await kindsOf(t, blob, first)).toEqual(["definitionBoxArt"]);
  });

  test("reports every kind that holds the blob", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBase(t);
    const blob = await storeBlob(t);
    await t.run(async (ctx) => {
      await SEEDS.definitionBoxArt(ctx, base, blob);
      await SEEDS.copyPhoto(ctx, base, blob);
      await SEEDS.preserved(ctx, base, blob);
    });
    expect((await kindsOf(t, blob)).sort()).toEqual(
      ["copyPhoto", "definitionBoxArt", "preserved"].sort(),
    );
  });
});

// --- Schema introspection -------------------------------------------------------------------

// Every `v.id("_storage")` field in the schema ("table.path", `[]` for an array element) and how
// blobReferenceKinds covers it. A field missing here fails the test below: register it as a kind
// in lib/imageModeration/blobReferences.ts (with an index), or explain here why it holds nothing a
// claim or a delete must respect. Reviewed for SEC-92.
const STORAGE_ID_FIELDS: Record<string, BlobReferenceKind | { not: string }> = {
  "boxArtUploads.storageId": "boxArtListing",
  "puzzles.image": "definitionBoxArt",
  "ownedPuzzleImages.fileId": "copyPhoto",
  "completionImages.fileId": "completionPhoto",
  "completions.photos[]": {
    not: "mirrored by its completionImages sidecar (completionPhoto); a legacy photo without a sidecar is the known residual",
  },
  "csamEscalations.fileId": "preserved",
  "messageAttachments.fileId": "messagePhoto",
  "messageAttachments.thumbFileId": "messageThumb",
  "messageAttachments.mapFileId": "locationMap",
  "circleIcons.fileId": "circleIcon",
  "reports.evidenceFileId": "reportEvidence",
};

// Storage ids kept in plain strings (domain-owned shapes), which the walk cannot tell from other
// strings. Listed so they are reviewed too; the test checks that each path still exists.
const STRING_STORAGE_FIELDS: Record<
  string,
  BlobReferenceKind | { not: string }
> = {
  "puzzleChangeProposals.changes.image": "proposedBoxArt",
  "puzzleChangeProposals.baseline.image": {
    not: "the definition's image when the proposal was made: compared for conflict markers, never served",
  },
  "ownedPuzzles.snapshot.thumbnail": {
    not: "a cached copy of puzzles.image: never served",
  },
};

type Leaf = { path: string; kind: string; tableName?: string };

const leaves = (validator: GenericValidator, path: string): Leaf[] => {
  switch (validator.kind) {
    case "object":
      return Object.entries(validator.fields).flatMap(([key, field]) =>
        leaves(field, path ? `${path}.${key}` : key),
      );
    case "union":
      return validator.members.flatMap((member) => leaves(member, path));
    case "array":
      return leaves(validator.element, `${path}[]`);
    case "record":
      return [
        ...leaves(validator.key, `${path}{key}`),
        ...leaves(validator.value, `${path}{}`),
      ];
    case "id":
      return [{ path, kind: "id", tableName: validator.tableName }];
    default:
      return [{ path, kind: validator.kind }];
  }
};

const schemaLeaves = (): Leaf[] =>
  Object.entries(schema.tables).flatMap(([table, definition]) =>
    leaves(definition.validator, "").map((leaf) => ({
      ...leaf,
      path: `${table}.${leaf.path}`,
    })),
  );

describe("schema storage-id fields", () => {
  test('every v.id("_storage") field is registered', () => {
    const fields = [
      ...new Set(
        schemaLeaves()
          .filter((leaf) => leaf.kind === "id" && leaf.tableName === "_storage")
          .map((leaf) => leaf.path),
      ),
    ].sort();
    expect(fields).toEqual(Object.keys(STORAGE_ID_FIELDS).sort());
  });

  test("every string field registered as a storage id still exists", () => {
    const strings = new Set(
      schemaLeaves()
        .filter((leaf) => leaf.kind === "string")
        .map((leaf) => leaf.path),
    );
    for (const path of Object.keys(STRING_STORAGE_FIELDS)) {
      expect(strings.has(path), path).toBe(true);
    }
  });

  test("every registered kind is one blobReferenceKinds reports", () => {
    const registered = new Set(
      [
        ...Object.values(STORAGE_ID_FIELDS),
        ...Object.values(STRING_STORAGE_FIELDS),
      ].filter(
        (entry): entry is BlobReferenceKind => typeof entry === "string",
      ),
    );
    expect([...registered].sort()).toEqual([...KINDS].sort());
  });
});
