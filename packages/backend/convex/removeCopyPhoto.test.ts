import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

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
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleAggregateId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

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

const addPhoto = (
  t: ReturnType<typeof convexTest>,
  copyId: Id<"ownedPuzzles">,
  uploader: Id<"users">,
): Promise<{ photoId: Id<"ownedPuzzleImages">; fileId: Id<"_storage"> }> =>
  t.run(async (ctx) => {
    const fileId = await ctx.storage.store(
      new Blob(["fake-image-bytes"], { type: "image/png" }),
    );
    const now = Date.now();
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: uploader,
      fileId,
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    return { photoId, fileId };
  });

const view = (t: ReturnType<typeof convexTest>, copyId: Id<"ownedPuzzles">) =>
  asAlice(t).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId,
  });

describe("library.removeCopyPhoto", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const { photoId } = await addPhoto(t, copyId, alice);
    await expect(
      t.mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId: photoId,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("owner removes a photo: the row + blob are gone and it leaves the gallery", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const { photoId, fileId } = await addPhoto(t, copyId, alice);

    // Visible before removal.
    expect((await view(t, copyId))?.gallery.some((p) => p.id === photoId)).toBe(
      true,
    );

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: photoId,
    });

    // Row gone, blob gone, absent from the gallery.
    const row = await t.run(async (ctx) => ctx.db.get(photoId));
    expect(row).toBeNull();
    const url = await t.run(async (ctx) => ctx.storage.getUrl(fileId));
    expect(url).toBeNull();
    expect((await view(t, copyId))?.gallery.some((p) => p.id === photoId)).toBe(
      false,
    );
  });

  test("removing the cover photo clears the copy's cover", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const { photoId } = await addPhoto(t, copyId, alice);

    await asAlice(t).mutation(api.library.setCopyCover.setCopyCover, {
      copyId,
      coverImageId: photoId,
    });
    expect((await t.run((ctx) => ctx.db.get(copyId)))?.coverImageId).toBe(
      photoId,
    );

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: photoId,
    });

    expect(
      (await t.run((ctx) => ctx.db.get(copyId)))?.coverImageId,
    ).toBeUndefined();
  });

  test("rejects a non-owner", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const { photoId } = await addPhoto(t, copyId, alice);

    await expect(
      asBob(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId: photoId,
      }),
    ).rejects.toThrow("Only the owner");
  });

  test("rejects an unknown photo", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const { photoId } = await addPhoto(t, copyId, alice);
    await t.run(async (ctx) => ctx.db.delete(photoId));

    await expect(
      asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId: photoId,
      }),
    ).rejects.toThrow("Photo not found");
  });
});
