import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + a catalog puzzle + a copy OWNED BY ALICE. Bob is the non-owner.
const seed = async (t: ReturnType<typeof convexTest>) =>
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

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

// A real stored blob so fileId is a valid `_storage` id the gallery could resolve.
const storeBlob = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));

describe("addCopyPhoto", () => {
  test("the owner can add a photo: a row appears in ownedPuzzleImages", async () => {
    const t = convexTest(schema, modules);
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

    // It would surface in the gallery, which reads the same table by_owned_puzzle.
    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: aliceCopy },
    );
    expect(view?.gallery.length).toBe(1);
  });

  test("a non-owner is rejected and nothing is written", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
