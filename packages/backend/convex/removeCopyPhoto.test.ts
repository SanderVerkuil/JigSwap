import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

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

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const acquireCopy = async (
  t: TestConvex<typeof schema>,
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
  t: TestConvex<typeof schema>,
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

const view = (t: TestConvex<typeof schema>, copyId: Id<"ownedPuzzles">) =>
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
    ).rejects.toThrow(
      "Only the copy's owner or the photo's uploader can remove this photo",
    );
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

// SEC-38: the member who uploaded a photo may remove it even when they can no longer manage the
// copy, e.g. the previous owner after the copy changed hands. Nobody else gains a right.
describe("library.removeCopyPhoto after a transfer", () => {
  // Alice's copy, with a photo she took, now owned by Bob (the transfer seeded by patching the
  // owner), plus a photo Bob took since. Carol is a stranger.
  const seedTransferred = async (t: TestConvex<typeof schema>) => {
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const copyId = await acquireCopy(t, puzzleAggregateId);
    const alicePhoto = await addPhoto(t, copyId, alice);
    await t.run(async (ctx) => {
      await ctx.db.patch(copyId, { ownerId: bob, heldBy: bob });
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "clerk_carol",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const bobPhoto = await addPhoto(t, copyId, bob);
    return { copyId, alicePhoto, bobPhoto };
  };

  test("the previous owner removes a photo they uploaded: row and blob are gone", async () => {
    const t = convexTest(schema, modules);
    const { alicePhoto } = await seedTransferred(t);

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: alicePhoto.photoId,
    });

    expect(await t.run((ctx) => ctx.db.get(alicePhoto.photoId))).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.system.get(alicePhoto.fileId)),
    ).toBeNull();
  });

  test("the previous owner cannot remove the new owner's photo", async () => {
    const t = convexTest(schema, modules);
    const { bobPhoto } = await seedTransferred(t);

    await expect(
      asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId: bobPhoto.photoId,
      }),
    ).rejects.toThrow(
      "Only the copy's owner or the photo's uploader can remove this photo",
    );
    expect(await t.run((ctx) => ctx.db.get(bobPhoto.photoId))).not.toBeNull();
  });

  test("a stranger cannot remove anyone's photo", async () => {
    const t = convexTest(schema, modules);
    const { alicePhoto, bobPhoto } = await seedTransferred(t);
    const asCarol = t.withIdentity({ subject: "clerk_carol" });

    for (const { photoId } of [alicePhoto, bobPhoto]) {
      await expect(
        asCarol.mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
          imageId: photoId,
        }),
      ).rejects.toThrow(
        "Only the copy's owner or the photo's uploader can remove this photo",
      );
    }
  });

  test("the new owner may still remove the previous owner's photo", async () => {
    const t = convexTest(schema, modules);
    const { alicePhoto } = await seedTransferred(t);

    await asBob(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: alicePhoto.photoId,
    });

    expect(await t.run((ctx) => ctx.db.get(alicePhoto.photoId))).toBeNull();
  });

  test("when the uploader removes the copy's cover, the cover falls back", async () => {
    const t = convexTest(schema, modules);
    const { copyId, alicePhoto } = await seedTransferred(t);
    await asBob(t).mutation(api.library.setCopyCover.setCopyCover, {
      copyId,
      coverImageId: alicePhoto.photoId,
    });

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: alicePhoto.photoId,
    });

    expect(
      (await t.run((ctx) => ctx.db.get(copyId)))?.coverImageId,
    ).toBeUndefined();
  });

  // The copy page is closed to a seller (getCopyInstanceView returns null), so this list is how they
  // reach the right above (SEC-38). It holds their own photos and nothing about the copy.
  const listMine = (t: TestConvex<typeof schema>, numItems = 50) =>
    asAlice(t).query(
      api.library.listMyPhotosOnFormerCopies.listMyPhotosOnFormerCopies,
      { paginationOpts: { numItems, cursor: null } },
    );

  test("the seller can't open the copy, but lists their own photo and removes it from there", async () => {
    const t = convexTest(schema, modules);
    const { copyId, alicePhoto, bobPhoto } = await seedTransferred(t);
    await t.run((ctx) =>
      ctx.db.patch(alicePhoto.photoId, { title: "my-own-caption" }),
    );
    expect(await view(t, copyId)).toBeNull();

    const { page, isDone } = await listMine(t);
    expect(isDone).toBe(true);
    expect(page.map((photo) => photo.imageId)).toEqual([alicePhoto.photoId]);
    expect(page[0]).toEqual({
      imageId: alicePhoto.photoId,
      url: expect.any(String),
      title: "my-own-caption",
      createdAt: expect.any(Number),
    });
    // Nothing about the copy or who has it now.
    const json = JSON.stringify(page);
    expect(json).not.toContain(copyId);
    expect(json).not.toContain(bobPhoto.photoId);
    expect(json).not.toContain("Mountain Vista");
    expect(json).not.toContain("clerk_bob");

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: page[0]!.imageId as Id<"ownedPuzzleImages">,
    });
    expect((await listMine(t)).page).toEqual([]);
  });

  test("photos on a copy they still manage, or nothing they uploaded, are not listed", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const mine = await acquireCopy(t, puzzleAggregateId);
    await addPhoto(t, mine, alice);
    expect((await listMine(t)).page).toEqual([]);

    // Bob's own photo on Bob's copy, and a stranger's list of nothing.
    await t.run((ctx) => ctx.db.patch(mine, { ownerId: bob }));
    await addPhoto(t, mine, bob);
    const bobs = await asBob(t).query(
      api.library.listMyPhotosOnFormerCopies.listMyPhotosOnFormerCopies,
      { paginationOpts: { numItems: 50, cursor: null } },
    );
    expect(bobs.page).toEqual([]);
  });

  test("a rejected or quarantined photo stays out; one still being checked has no URL", async () => {
    const t = convexTest(schema, modules);
    const { copyId, alicePhoto } = await seedTransferred(t);
    const { alice } = await t.run(async (ctx) => ({
      alice: (await ctx.db.get(alicePhoto.photoId))!.uploaderId,
    }));
    const pending = await addPhoto(t, copyId, alice);
    const rejected = await addPhoto(t, copyId, alice);
    const quarantined = await addPhoto(t, copyId, alice);
    await t.run(async (ctx) => {
      await ctx.db.patch(pending.photoId, {
        moderationStatus: "pending",
        hashCheckPendingSince: 1,
      });
      await ctx.db.patch(rejected.photoId, { moderationStatus: "rejected" });
      await ctx.db.patch(quarantined.photoId, {
        moderationStatus: "quarantined",
      });
    });

    const { page } = await listMine(t);
    expect(page.map((photo) => photo.imageId).sort()).toEqual(
      [alicePhoto.photoId, pending.photoId].sort(),
    );
    expect(
      page.find((photo) => photo.imageId === pending.photoId)?.url,
    ).toBeNull();
  });

  test("a photo whose copy is gone is not listed: removing it could only fail", async () => {
    const t = convexTest(schema, modules);
    const { copyId } = await seedTransferred(t);
    await t.run((ctx) => ctx.db.delete(copyId));
    expect((await listMine(t)).page).toEqual([]);
  });

  test("a member who left the household lists what they added to a mate's copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seed(t);
    await asBob(t).mutation(api.household.createHousehold.createHousehold, {});
    const inviteId = await asBob(t).mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: alice },
    );
    await asAlice(t).mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
    const copyId = await acquireCopy(t, puzzleAggregateId);
    await t.run((ctx) => ctx.db.patch(copyId, { ownerId: bob }));
    const photo = await addPhoto(t, copyId, alice);
    expect((await listMine(t)).page).toEqual([]);

    await asAlice(t).mutation(api.household.leaveHousehold.leaveHousehold, {});
    expect((await listMine(t)).page.map((p) => p.imageId)).toEqual([
      photo.photoId,
    ]);
  });

  test("paged over everything they uploaded, newest first, and a page size is only a request", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, puzzleAggregateId } = await seed(t);
    const sold = await acquireCopy(t, puzzleAggregateId);
    const kept = await acquireCopy(t, puzzleAggregateId);
    const older = await addPhoto(t, sold, alice);
    await addPhoto(t, kept, alice);
    await t.run((ctx) => ctx.db.patch(sold, { ownerId: bob }));

    // The newest upload is on a copy Alice still has: its page is empty, not the end.
    const first = await listMine(t, 1);
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const second = await asAlice(t).query(
      api.library.listMyPhotosOnFormerCopies.listMyPhotosOnFormerCopies,
      { paginationOpts: { numItems: 1, cursor: first.continueCursor } },
    );
    expect(second.page.map((photo) => photo.imageId)).toEqual([older.photoId]);

    for (let i = 0; i < 60; i++) await addPhoto(t, sold, alice);
    expect((await listMine(t, 100_000)).page).toHaveLength(50);
  });

  test("needs a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seedTransferred(t);
    await expect(
      t.query(
        api.library.listMyPhotosOnFormerCopies.listMyPhotosOnFormerCopies,
        { paginationOpts: { numItems: 10, cursor: null } },
      ),
    ).rejects.toThrow();
  });
});
