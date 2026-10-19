import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// library/addCopyImage (the domain path for adding a copy photo) must put the photo through the
// shared image-moderation pipeline exactly like addCopyPhoto: inserted "pending", unpublished
// until the CSAM hash check has passed, with the moderatePhoto job scheduled. Before, it wrote a
// row with no moderation status, which every read path treats as a legacy approved photo.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, copy, copyAggregateId };
  });

describe("addCopyImage", () => {
  test("a new photo is inserted pending behind the hash-check gate and schedules moderation", async () => {
    const t = convexTest(schema, modules);
    const { alice, copy, copyAggregateId } = await seed(t);
    const fileId = (await t.run((ctx) =>
      ctx.storage.store(new Blob(["img"], { type: "image/png" })),
    )) as Id<"_storage">;

    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.library.addCopyImage.addCopyImage, {
        copyId: copyAggregateId,
        fileId,
        tag: "box_front",
      });

    const images = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
        .collect(),
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      fileId,
      uploaderId: alice,
      moderationStatus: "pending",
    });
    expect(images[0].hashCheckPendingSince).toBeGreaterThan(0);
    expect(images[0].hashCheckedAt).toBeUndefined();

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const job = jobs.find((s) => s.name.includes("moderatePhoto"));
    expect((job?.args[0] as { imageId?: string })?.imageId).toBe(
      images[0]._id as string,
    );
  });
});
