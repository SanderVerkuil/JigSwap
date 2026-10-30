import { MAX_COPY_IMAGE_TITLE_LENGTH, MAX_COPY_IMAGES } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + a catalog puzzle + a copy OWNED BY ALICE. Bob is the non-owner.
const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com");
    const bob = await mkUser("clerk_bob", "bob@example.com");

    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const aliceCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, aliceCopy };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

// A real stored blob so fileId is a valid `_storage` id the gallery could resolve.
const storeBlob = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));

describe("addCopyPhoto", () => {
  test("the owner can add a photo: a row appears in ownedPuzzleImages", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: aliceCopy,
      fileId,
      tag: "box_front",
      title: "Front of box",
    });

    const images = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", aliceCopy))
        .collect(),
    );
    expect(images).toHaveLength(1);
    expect(images[0].fileId).toBe(fileId);
    expect(images[0].uploaderId).toBe(alice);
    expect(images[0].tag).toBe("box_front");
    expect(images[0].title).toBe("Front of box");
    expect(images[0].createdAt).toBeGreaterThan(0);
    expect(images[0].updatedAt).toBe(images[0].createdAt);

    // The gallery reads the same table by_owned_puzzle, but never serves this photo yet: until
    // the CSAM hash check has passed the uploader gets a placeholder, not a URL
    // (lib/imageModeration/hashCheckFields), and these fake bytes are refused by the pipeline's
    // input guards once it runs. Either way: no gallery entry.
    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: aliceCopy },
    );
    expect(view?.gallery).toEqual([]);
  });

  test("a new photo is inserted pending and schedules the moderation job", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: aliceCopy,
      fileId,
      tag: "box_front",
    });

    // The row starts in "pending" until the async pipeline decides.
    const images = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", aliceCopy))
        .collect(),
    );
    expect(images).toHaveLength(1);
    expect(images[0].moderationStatus).toBe("pending");
    expect(images[0].moderationScore).toBeUndefined();

    // The moderation check was enqueued on the pool for this exact image: it ran once.
    await settleDueScheduled(t);
    const checked = await t.run((ctx) => ctx.db.get(images[0]._id));
    expect(checked?.moderationAttempts).toBe(1);
  });

  test("a non-owner is rejected and nothing is written", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await expect(
      asBob(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
        copyId: aliceCopy,
        fileId,
      }),
    ).rejects.toThrow(ConvexError);

    const images = await t.run((ctx) =>
      ctx.db.query("ownedPuzzleImages").collect(),
    );
    expect(images).toHaveLength(0);
  });

  test("auth is required", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const fileId = (await storeBlob(t)) as Id<"_storage">;

    await expect(
      t.mutation(api.library.addCopyPhoto.addCopyPhoto, {
        copyId: aliceCopy,
        fileId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("addCopyPhoto: per-copy bounds", () => {
  // convex-test may hand ConvexError.data over as a JSON string; normalise.
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      const data = (error as ConvexError<Value>).data;
      return (typeof data === "string" ? JSON.parse(data) : data).code;
    }
    throw new Error("expected a refusal");
  };

  const seedPhotos = (
    t: TestConvex<typeof schema>,
    copy: Id<"ownedPuzzles">,
    uploaderId: Id<"users">,
    count: number,
    moderationStatus:
      "approved" | "pending" | "rejected" | "quarantined" = "approved",
  ) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId,
          fileId: await ctx.storage.store(new Blob([`img${i}`])),
          moderationStatus,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

  const photoCount = (t: TestConvex<typeof schema>) =>
    t.run(
      async (ctx) => (await ctx.db.query("ownedPuzzleImages").collect()).length,
    );

  test(`a copy with ${MAX_COPY_IMAGES} photos takes no more, and nothing is charged or written`, async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    await seedPhotos(t, aliceCopy, alice, MAX_COPY_IMAGES);

    expect(
      await codeOf(
        asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
          copyId: aliceCopy,
          fileId: (await storeBlob(t)) as Id<"_storage">,
        }),
      ),
    ).toBe("TooManyImages");
    expect(await photoCount(t)).toBe(MAX_COPY_IMAGES);
    expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toEqual(
      [],
    );
  });

  test("the photo before the cap is still taken", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    await seedPhotos(t, aliceCopy, alice, MAX_COPY_IMAGES - 1);

    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: aliceCopy,
      fileId: (await storeBlob(t)) as Id<"_storage">,
    });
    expect(await photoCount(t)).toBe(MAX_COPY_IMAGES);
    await settleDueScheduled(t);
  });

  // Rejected and quarantined photos are hidden from everyone, the owner included, so the owner
  // could never remove them to make room: they take none of the copy's places.
  test("rejected and quarantined photos don't take one of the copy's places", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    await seedPhotos(t, aliceCopy, alice, MAX_COPY_IMAGES - 1);
    await seedPhotos(t, aliceCopy, alice, 3, "rejected");
    await seedPhotos(t, aliceCopy, alice, 2, "quarantined");

    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: aliceCopy,
      fileId: (await storeBlob(t)) as Id<"_storage">,
    });
    expect(await photoCount(t)).toBe(MAX_COPY_IMAGES + 5);

    // The new photo is still pending, so it takes the last place.
    expect(
      await codeOf(
        asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
          copyId: aliceCopy,
          fileId: (await storeBlob(t)) as Id<"_storage">,
        }),
      ),
    ).toBe("TooManyImages");
    await settleDueScheduled(t);
  });

  test("photos still being checked take a place", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    await seedPhotos(t, aliceCopy, alice, MAX_COPY_IMAGES - 1);
    await seedPhotos(t, aliceCopy, alice, 1, "pending");

    expect(
      await codeOf(
        asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
          copyId: aliceCopy,
          fileId: (await storeBlob(t)) as Id<"_storage">,
        }),
      ),
    ).toBe("TooManyImages");
  });

  test("an over-long title is refused", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);

    expect(
      await codeOf(
        asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
          copyId: aliceCopy,
          fileId: (await storeBlob(t)) as Id<"_storage">,
          title: "x".repeat(MAX_COPY_IMAGE_TITLE_LENGTH + 1),
        }),
      ),
    ).toBe("ImageTextTooLong");
    expect(await photoCount(t)).toBe(0);
  });
});
