import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + a puzzle + a copy + ONE uploaded photo on that copy. Photo comments key to the
// `ownedPuzzleImages` _id, so the photo id is what the API is called with.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com", "Alice");
    const bob = await mkUser("clerk_bob", "bob@example.com", "Bob");

    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    const fileId = await ctx.storage.store(blob);
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId,
      title: "Box front",
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, photoId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("postPhotoComment / listPhotoComments", () => {
  test("posts a comment on a photo; list returns it with the real author", async () => {
    const t = convexTest(schema, modules);
    const { alice, photoId } = await seed(t);

    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "Love this shot",
    });

    // Persisted under the photoId (the `ownedPuzzleImages` _id), with an aggregateId.
    const stored = await t.run((ctx) =>
      ctx.db.query("photoComments").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].photoId).toBe(photoId);
    expect(stored[0].aggregateId).toBeDefined();

    const list = await asAlice(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("Love this shot");
    // Real author identity — never anonymised. No rating on photo comments.
    expect(list[0].author._id).toBe(alice as string);
    expect(list[0].author.name).toBe("Alice");
    expect("rating" in list[0]).toBe(false);
  });

  test("anyone authenticated may comment on a shared photo", async () => {
    const t = convexTest(schema, modules);
    const { bob, photoId } = await seed(t);

    // Bob is not the photo's uploader, but may still comment.
    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "from bob",
    });

    const list = await asBob(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    expect(list).toHaveLength(1);
    expect(list[0].author._id).toBe(bob as string);
  });

  test("comments are returned newest-first", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);

    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "first",
    });
    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "second",
    });

    const list = await asAlice(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    expect(list.map((c) => c.text)).toEqual(["second", "first"]);
  });

  test("comments are scoped to their photo", async () => {
    const t = convexTest(schema, modules);
    const { alice, photoId } = await seed(t);

    // A second photo on the same copy gets its own thread.
    const otherPhoto = await t.run(
      async (ctx): Promise<Id<"ownedPuzzleImages">> => {
        const photo = await ctx.db.get(photoId);
        const blob = new Blob(["other"], { type: "image/png" });
        const fileId = await ctx.storage.store(blob);
        return ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: photo!.ownedPuzzleId,
          uploaderId: alice,
          fileId,
          tag: "pieces",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      },
    );

    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "on first photo",
    });
    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId: otherPhoto,
      text: "on second photo",
    });

    const firstList = await asAlice(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    expect(firstList.map((c) => c.text)).toEqual(["on first photo"]);
    const secondList = await asAlice(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId: otherPhoto },
    );
    expect(secondList.map((c) => c.text)).toEqual(["on second photo"]);
  });

  test("empty / whitespace-only text is rejected and persists nothing", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);

    await expect(
      asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
        photoId,
        text: "   ",
      }),
    ).rejects.toThrow(ConvexError);

    const stored = await t.run((ctx) =>
      ctx.db.query("photoComments").collect(),
    );
    expect(stored).toHaveLength(0);
  });

  test("auth is required to post a photo comment", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);

    await expect(
      t.mutation(api.library.postPhotoComment.postPhotoComment, {
        photoId,
        text: "anon",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
