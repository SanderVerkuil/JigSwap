import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// catalog/boxArtInCheck: the uploader (and only the uploader) learns that their box art is still
// being checked. The box art reaches "unscored" the real way: the classifier has no token.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    for (const clerkId of ["clerk_alice", "clerk_bob"]) {
      await ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

// Alice uploads box art and submits a definition with it.
const submitWithBoxArt = async (t: TestConvex<typeof schema>) => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  const upload = (await t.run((ctx) =>
    ctx.storage.store(new Blob([bytes], { type: "image/jpeg" })),
  )) as Id<"_storage">;
  const storageId = await asAlice(t).action(
    api.catalog.sanitizeBoxArt.sanitizeBoxArt,
    { storageId: upload },
  );
  await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000, image: storageId },
  );
  const puzzle = await t.run((ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", storageId))
      .unique(),
  );
  const row = await t.run((ctx) =>
    ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique(),
  );
  return { storageId, puzzleId: puzzle!._id, rowId: row!._id };
};

describe("box art still being checked", () => {
  test("the uploader sees it; another member and an anonymous caller do not", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { storageId, puzzleId } = await submitWithBoxArt(t);

    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: storageId,
      }),
    ).toBe(true);
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([puzzleId]);

    expect(
      await asBob(t).query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: storageId,
      }),
    ).toBe(false);
    expect(
      await asBob(t).query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([]);
    expect(
      await t.query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: storageId,
      }),
    ).toBe(false);
    expect(
      await t.query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([]);
  });

  test("approved box art whose hash check has not passed is still being checked", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { storageId, puzzleId, rowId } = await submitWithBoxArt(t);
    await t.run((ctx) =>
      ctx.db.patch(rowId, {
        moderationStatus: "approved",
        hashCheckedAt: undefined,
        hashCheckPendingSince: Date.now(),
      }),
    );
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: storageId,
      }),
    ).toBe(true);
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([puzzleId]);
  });

  test("other members' box art waiting on its hash check never crowds out the uploader's own", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { puzzleId, rowId } = await submitWithBoxArt(t);
    await t.run(async (ctx) => {
      const bob = (await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_bob"))
        .unique())!._id;
      const blob = await ctx.storage.store(new Blob(["x"]));
      // More than a page of Bob's held box art, all waiting longer than Alice's.
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("boxArtUploads", {
          storageId: blob,
          uploaderId: bob,
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000 + i,
          createdAt: 1_000,
        });
      }
      await ctx.db.patch(rowId, {
        moderationStatus: "approved",
        hashCheckedAt: undefined,
        hashCheckPendingSince: Date.now(),
      });
    });
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([puzzleId]);
  });

  test("served box art, and garbage ids, are not reported", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { storageId, rowId } = await submitWithBoxArt(t);
    await t.run((ctx) => ctx.db.patch(rowId, { moderationStatus: "approved" }));
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: storageId,
      }),
    ).toBe(false);
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.listMyBoxArtInCheck, {}),
    ).toEqual([]);
    expect(
      await asAlice(t).query(api.catalog.boxArtInCheck.isMyBoxArtInCheck, {
        image: "not-an-id",
      }),
    ).toBe(false);
  });
});
