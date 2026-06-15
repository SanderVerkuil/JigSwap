import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed two members + a catalog puzzle (with aggregateId) the snapshot provider can resolve. The
// puzzle carries a global thumbnail so the fall-back path is observable.
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
    const puzzleAggregateId = crypto.randomUUID();
    // The puzzle's global catalogue image is a stored box-art file; its storage id is what the
    // Copy caches as its snapshot thumbnail (the global-image fall-back the cover overrides).
    const globalImageId = await ctx.storage.store(
      new Blob(["global-box-art"], { type: "image/png" }),
    );
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      image: globalImageId,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleAggregateId, globalImageId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

// Alice acquires a copy of the seeded puzzle; resolve the copy's Convex _id (cover/gallery key).
const acquireCopy = async (
  t: ReturnType<typeof convexTest>,
  puzzleAggregateId: string,
): Promise<Id<"ownedPuzzles">> => {
  const aggregateId = (await asAlice(t).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
  )) as string;
  const row = await t.run(async (ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );
  if (!row) throw new Error("copy row not found");
  return row._id;
};

// Insert an ownedPuzzleImages row (with a real stored blob) for the given copy, returning its id.
const addPhoto = (
  t: ReturnType<typeof convexTest>,
  copyId: Id<"ownedPuzzles">,
  uploader: Id<"users">,
): Promise<Id<"ownedPuzzleImages">> =>
  t.run(async (ctx) => {
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    const fileId = await ctx.storage.store(blob);
    const now = Date.now();
    return ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: uploader,
      fileId,
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
  });

const view = (t: ReturnType<typeof convexTest>, copyId: Id<"ownedPuzzles">) =>
  asAlice(t).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId,
  });

describe("library.setCopyCover", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    await expect(
      t.mutation(api.library.setCopyCover.setCopyCover, { copyId }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("owner sets the cover to one of the copy's photos; the snapshot reflects it", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const photoId = await addPhoto(t, copyId, alice);

    await asAlice(t).mutation(api.library.setCopyCover.setCopyCover, {
      copyId,
      coverImageId: photoId,
    });

    // Persisted on the copy row.
    const row = await t.run(async (ctx) => ctx.db.get(copyId));
    expect(row?.coverImageId).toBe(photoId);

    // The snapshot resolves image -> the photo's URL and reports the selection.
    const v = await view(t, copyId);
    expect(v?.snapshot.coverImageId).toBe(photoId as string);
    expect(v?.snapshot.image).toEqual(expect.any(String));
    // The chosen photo's URL is the gallery photo's URL (same stored file), not the global image.
    const galleryUrl = v?.gallery.find(
      (p) => p.id === (photoId as string),
    )?.url;
    expect(v?.snapshot.image).toBe(galleryUrl);
  });

  test("clearing the cover (undefined) falls back to the puzzle's global image", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId, globalImageId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const photoId = await addPhoto(t, copyId, alice);

    await asAlice(t).mutation(api.library.setCopyCover.setCopyCover, {
      copyId,
      coverImageId: photoId,
    });
    // Now clear it.
    await asAlice(t).mutation(api.library.setCopyCover.setCopyCover, {
      copyId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(copyId));
    expect(row?.coverImageId).toBeUndefined();

    const v = await view(t, copyId);
    expect(v?.snapshot.coverImageId).toBeNull();
    // Fall back to the puzzle's global catalogue image, RESOLVED to a URL (not the raw storage id —
    // emitting the raw id would render a broken <img src>).
    const globalUrl = await t.run((ctx) => ctx.storage.getUrl(globalImageId));
    expect(v?.snapshot.image).toBe(globalUrl);
    expect(v?.snapshot.image).not.toBe(globalImageId as string);
  });

  test("rejects a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const photoId = await addPhoto(t, copyId, alice);

    await expect(
      asBob(t).mutation(api.library.setCopyCover.setCopyCover, {
        copyId,
        coverImageId: photoId,
      }),
    ).rejects.toThrow("Only the owner");
  });

  test("rejects a photo belonging to a DIFFERENT copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const otherCopyId = await acquireCopy(t, puzzleAggregateId);
    // A photo attached to the OTHER copy.
    const foreignPhotoId = await addPhoto(t, otherCopyId, alice);

    await expect(
      asAlice(t).mutation(api.library.setCopyCover.setCopyCover, {
        copyId,
        coverImageId: foreignPhotoId,
      }),
    ).rejects.toThrow("does not belong to this copy");

    // No cover was set on the target copy.
    const row = await t.run(async (ctx) => ctx.db.get(copyId));
    expect(row?.coverImageId).toBeUndefined();
  });

  test("rejects an unknown copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    // A real copy whose _id we then delete to fabricate a dangling id is awkward; instead use a
    // syntactically valid id from a deleted copy.
    const copyId = await acquireCopy(t, puzzleAggregateId);
    await t.run(async (ctx) => ctx.db.delete(copyId));

    await expect(
      asAlice(t).mutation(api.library.setCopyCover.setCopyCover, { copyId }),
    ).rejects.toThrow("Copy not found");
    expect(alice).toBeDefined();
  });
});
