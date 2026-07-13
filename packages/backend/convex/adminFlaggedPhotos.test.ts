import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The flagged-photos review queue: admins list auto-rejected photos, then either restore them
// (false positive) or confirm the removal (deletes row + blob, stamps the audit trail, and
// notifies the uploader).

// Seed the uploader, a DISTINCT admin user, an approved puzzle, and a copy carrying a snapshot
// title. The two users keep the "stamp actor is the admin, notification goes to the uploader"
// assertions load-bearing. The Clerk subject maps to the user via by_clerk_id.
const seedWorld = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const adminId = await ctx.db.insert("users", {
      clerkId: "clerk_ada",
      email: "ada@example.com",
      name: "Ada Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: userId,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      snapshot: { title: "Starry Night", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { userId, adminId, puzzleId, copyId };
  });

// Seed one photo row with a REAL stored blob so ctx.storage.getUrl/delete operate on it.
const seedPhoto = (
  t: ReturnType<typeof convexTest>,
  copyId: Id<"ownedPuzzles">,
  userId: Id<"users">,
  moderationStatus: "pending" | "approved" | "rejected",
  extra?: { moderationScore?: number; moderationLabel?: string },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
    const imageId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: userId,
      fileId,
      moderationStatus,
      ...extra,
      createdAt: now,
      updatedAt: now,
    });
    return { imageId, fileId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

describe("listRejectedPhotos", () => {
  test("returns only rejected rows, with url/score/label/uploader/title populated", async () => {
    const t = convexTest(schema, modules);
    const { userId, copyId } = await seedWorld(t);
    await seedPhoto(t, copyId, userId, "pending");
    await seedPhoto(t, copyId, userId, "approved");
    const rejected = await seedPhoto(t, copyId, userId, "rejected", {
      moderationScore: 0.97,
      moderationLabel: "nsfw",
    });

    const rows = await asAdmin(t).query(
      api.admin.listRejectedPhotos.listRejectedPhotos,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      imageId: rejected.imageId,
      score: 0.97,
      label: "nsfw",
      uploaderName: "Alice",
      puzzleTitle: "Starry Night",
    });
    expect(typeof rows[0].url).toBe("string");
    expect(typeof rows[0].uploadedAt).toBe("number");
  });
});

describe("restorePhoto", () => {
  test("flips a rejected photo to approved and stamps photo_restored with the acting admin", async () => {
    const t = convexTest(schema, modules);
    const { userId, adminId, copyId } = await seedWorld(t);
    const { imageId } = await seedPhoto(t, copyId, userId, "rejected", {
      moderationScore: 0.97,
      moderationLabel: "nsfw",
    });

    await asAdmin(t).mutation(api.admin.restorePhoto.restorePhoto, {
      imageId,
    });

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row?.moderationStatus).toBe("approved");
    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    // The stamp's actor is the ADMIN, not the uploader.
    expect(actions[0]).toMatchObject({
      actorId: adminId,
      kind: "photo_restored",
      targetLabel: "Starry Night",
      targetId: imageId,
    });
  });

  test("a non-rejected photo is refused and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const { userId, copyId } = await seedWorld(t);
    const { imageId } = await seedPhoto(t, copyId, userId, "pending");

    await expect(
      asAdmin(t).mutation(api.admin.restorePhoto.restorePhoto, { imageId }),
    ).rejects.toThrow();

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row?.moderationStatus).toBe("pending");
    expect(await allActions(t)).toHaveLength(0);
  });
});

describe("confirmPhotoRemoval", () => {
  test("deletes row + blob, stamps photo_removal_confirmed, and notifies the uploader once", async () => {
    const t = convexTest(schema, modules);
    const { userId, adminId, copyId } = await seedWorld(t);
    const { imageId, fileId } = await seedPhoto(t, copyId, userId, "rejected", {
      moderationScore: 0.97,
      moderationLabel: "nsfw",
    });

    await asAdmin(t).mutation(
      api.admin.confirmPhotoRemoval.confirmPhotoRemoval,
      { imageId },
    );

    // Row and blob are both gone.
    expect(await t.run((ctx) => ctx.db.get(imageId))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(fileId))).toBeNull();

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    // The stamp's actor is the ADMIN, not the uploader.
    expect(actions[0]).toMatchObject({
      actorId: adminId,
      kind: "photo_removal_confirmed",
      targetLabel: "Starry Night",
      targetId: imageId,
    });

    // Exactly one photo_removed notification for the UPLOADER, not the acting admin
    // (default prefs: inApp only).
    const notifications = await t.run((ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const removed = notifications.filter((n) => n.type === "photo_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      userId,
      type: "photo_removed",
      relatedId: copyId,
      isRead: false,
    });
    // No pre-rendered copy on the create path — renderers use type + params (photo_removed takes none).
    expect(removed[0]?.title).toBeUndefined();
    expect(removed[0]?.message).toBeUndefined();
  });

  test("a non-rejected photo is refused: row stays, nothing stamped, nobody notified", async () => {
    const t = convexTest(schema, modules);
    const { userId, copyId } = await seedWorld(t);
    const { imageId } = await seedPhoto(t, copyId, userId, "approved");

    await expect(
      asAdmin(t).mutation(api.admin.confirmPhotoRemoval.confirmPhotoRemoval, {
        imageId,
      }),
    ).rejects.toThrow();

    expect(await t.run((ctx) => ctx.db.get(imageId))).not.toBeNull();
    expect(await allActions(t)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("notifications").collect()),
    ).toHaveLength(0);
  });
});

describe("the review queue is admin-gated", () => {
  test("a signed-in non-admin member is Forbidden", async () => {
    const t = convexTest(schema, modules);
    const { userId, copyId } = await seedWorld(t);
    const { imageId } = await seedPhoto(t, copyId, userId, "rejected");

    await expect(
      asAlice(t).query(api.admin.listRejectedPhotos.listRejectedPhotos, {}),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asAlice(t).mutation(api.admin.restorePhoto.restorePhoto, { imageId }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asAlice(t).mutation(api.admin.confirmPhotoRemoval.confirmPhotoRemoval, {
        imageId,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("an unauthenticated caller is rejected", async () => {
    const t = convexTest(schema, modules);
    const { userId, copyId } = await seedWorld(t);
    const { imageId } = await seedPhoto(t, copyId, userId, "rejected");

    await expect(
      t.query(api.admin.listRejectedPhotos.listRejectedPhotos, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.admin.restorePhoto.restorePhoto, { imageId }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.admin.confirmPhotoRemoval.confirmPhotoRemoval, {
        imageId,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
