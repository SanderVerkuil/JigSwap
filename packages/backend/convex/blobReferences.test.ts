import { convexTest, type TestConvex } from "convex-test";
import type { GenericValidator } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  BLOB_HOLDER_KINDS as KINDS,
  seedBlobHolderBase as seedBase,
  BLOB_HOLDER_SEEDS as SEEDS,
  storeBlob,
} from "../test-fixtures/blobHolders";
import type { Id } from "./_generated/dataModel";
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
  "imageRenditions.small.fileId": "renditionSmall",
  "imageRenditions.medium.fileId": "renditionMedium",
  "imageRenditions.large.fileId": "renditionLarge",
  "imageRenditions.sourceId": {
    not: "names the image the row was made from, which the row follows: whatever deletes that image calls renditionsStore.deleteRenditions",
  },
};

// Storage ids kept in plain strings (domain-owned shapes), which the walk cannot tell from other
// strings. Listed so they are reviewed too; the test checks that each path still exists.
const STRING_STORAGE_FIELDS: Record<
  string,
  BlobReferenceKind | { not: string }
> = {
  "puzzleChangeProposals.changes.image": "proposedBoxArt",
  "puzzleChangeProposals.baseline.image": {
    not: "the definition's image when the proposal was made: compared for conflict markers; its URL is sent only while the blob exists",
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
