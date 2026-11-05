import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-81: deleting a copy deletes its photos' blobs too, so their issued URLs stop working and
// nothing orphans in storage. A blob that something else still holds survives: one a CSAM
// escalation preserves, and catalogue box art a legacy photo row (written before the claim rule)
// holds.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const store = (t: T) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/png" }),
      ) as Promise<Id<"_storage">>,
  );

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

// Alice owns a copy of a puzzle whose box art is `boxArt`.
const seed = async (t: T) => {
  const boxArt = await store(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      image: boxArt,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: definitionId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, boxArt, puzzleId, copy, copyAggregateId };
  });
};

type Seeded = Awaited<ReturnType<typeof seed>>;

const photoRow = (t: T, s: Seeded, fileId: Id<"_storage">) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: s.copy,
      uploaderId: s.alice,
      fileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const deleteCopy = (t: T, s: Seeded) =>
  t
    .withIdentity({ subject: "clerk_alice" })
    .mutation(api.library.deleteCopy.deleteCopy, {
      copyId: s.copyAggregateId,
    });

describe("deleteCopy and photo blobs", () => {
  test("deleting a copy deletes its photos' blobs", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const first = await store(t);
    const second = await store(t);
    await photoRow(t, s, first);
    await photoRow(t, s, second);

    await deleteCopy(t, s);

    expect(await t.run((ctx) => ctx.db.get(s.copy))).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("ownedPuzzleImages").collect()),
    ).toEqual([]);
    expect(await blobExists(t, first)).toBe(false);
    expect(await blobExists(t, second)).toBe(false);
  });

  test("a blob something else holds survives the copy", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const preserved = await store(t);
    const own = await store(t);
    // A legacy row holding the catalogue box art, and one whose blob a CSAM escalation preserves.
    await photoRow(t, s, s.boxArt);
    const quarantinedRow = await photoRow(t, s, preserved);
    await photoRow(t, s, own);
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "ownedPuzzleImages",
        rowId: quarantinedRow,
        uploaderId: s.alice,
        fileId: preserved,
        md5: "md5",
        sha1: "sha1",
        provider: "offlimits",
        matchedAt: Date.now(),
        status: "open",
      }),
    );

    await deleteCopy(t, s);

    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(s.puzzleId)))?.image).toBe(
      s.boxArt,
    );
    expect(await blobExists(t, preserved)).toBe(true);
    expect(await blobExists(t, own)).toBe(false);
  });
});
