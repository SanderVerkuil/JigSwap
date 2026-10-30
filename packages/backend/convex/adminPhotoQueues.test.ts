import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { IMAGE_REVIEW_QUEUE_LIMIT } from "./admin/listImageReviewRequests";
import { REJECTED_PHOTOS_QUEUE_LIMIT } from "./admin/listRejectedPhotos";
import schema from "./schema";

// The admin photo queues read a bounded page, not every row the table ever held (SEC-19):
// admin/listRejectedPhotos the oldest 100 auto-rejected copy photos, admin/listImageReviewRequests
// the oldest 100 open review requests, found through an index of undecided rejected requests, so
// decided requests no longer cost a read.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    await mkUser("clerk_admin");
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
    return { alice, copy };
  });

const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

type ImageRequest = {
  status: "rejected" | "quarantined";
  requestedAt?: number;
  decidedAt?: number;
};

const seedMessageImages = (
  t: TestConvex<typeof schema>,
  uploaderId: Id<"users">,
  rows: readonly ImageRequest[],
) =>
  t.run(async (ctx) => {
    const ids = [];
    for (const row of rows) {
      ids.push(
        await ctx.db.insert("messageAttachments", {
          kind: "image",
          threadAggregateId: "thread-1",
          uploaderId,
          fileId: await ctx.storage.store(new Blob(["img"])),
          byteSize: 3,
          contentType: "image/jpeg",
          moderationStatus: row.status,
          hashCheckedAt: 1,
          ...(row.requestedAt !== undefined && {
            reviewRequestedAt: row.requestedAt,
          }),
          ...(row.decidedAt !== undefined && {
            reviewDecidedAt: row.decidedAt,
          }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    }
    return ids;
  });

describe("listRejectedPhotos", () => {
  test(`lists the oldest ${REJECTED_PHOTOS_QUEUE_LIMIT} rejected photos, not every one`, async () => {
    const t = convexTest(schema, modules);
    const { alice, copy } = await seed(t);
    const ids = await t.run(async (ctx) => {
      const inserted = [];
      for (let i = 0; i < REJECTED_PHOTOS_QUEUE_LIMIT + 20; i++) {
        inserted.push(
          await ctx.db.insert("ownedPuzzleImages", {
            ownedPuzzleId: copy,
            uploaderId: alice,
            fileId: await ctx.storage.store(new Blob([`img${i}`])),
            moderationStatus: "rejected",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
      }
      return inserted;
    });

    const listed = await asAdmin(t).query(
      api.admin.listRejectedPhotos.listRejectedPhotos,
      {},
    );

    expect(listed.map((photo) => photo.imageId)).toEqual(
      ids.slice(0, REJECTED_PHOTOS_QUEUE_LIMIT),
    );
  });
});

describe("listImageReviewRequests", () => {
  test("finds the one open request behind many decided ones", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await seedMessageImages(
      t,
      alice,
      Array.from({ length: IMAGE_REVIEW_QUEUE_LIMIT + 50 }, (_, i) => ({
        status: "rejected" as const,
        requestedAt: i + 1,
        decidedAt: i + 2,
      })),
    );
    const [open] = await seedMessageImages(t, alice, [
      { status: "rejected", requestedAt: 10_000 },
    ]);

    const listed = await asAdmin(t).query(
      api.admin.listImageReviewRequests.listImageReviewRequests,
      {},
    );

    expect(listed.map((request) => request.attachmentId)).toEqual([open]);
  });

  test("lists open requests oldest first, and only rejected photos whose sender asked", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const [later, earlier] = await seedMessageImages(t, alice, [
      { status: "rejected", requestedAt: 50 },
      { status: "rejected", requestedAt: 20 },
      // Not listed: no review asked, a quarantined photo (nobody may view it), a decided one.
      { status: "rejected" },
      { status: "quarantined", requestedAt: 10 },
      { status: "rejected", requestedAt: 5, decidedAt: 6 },
    ]);

    const listed = await asAdmin(t).query(
      api.admin.listImageReviewRequests.listImageReviewRequests,
      {},
    );

    expect(listed.map((request) => request.attachmentId)).toEqual([
      earlier,
      later,
    ]);
  });

  test(`lists at most ${IMAGE_REVIEW_QUEUE_LIMIT} open requests`, async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const ids = await seedMessageImages(
      t,
      alice,
      Array.from({ length: IMAGE_REVIEW_QUEUE_LIMIT + 5 }, (_, i) => ({
        status: "rejected" as const,
        requestedAt: i + 1,
      })),
    );

    const listed = await asAdmin(t).query(
      api.admin.listImageReviewRequests.listImageReviewRequests,
      {},
    );

    expect(listed.map((request) => request.attachmentId)).toEqual(
      ids.slice(0, IMAGE_REVIEW_QUEUE_LIMIT),
    );
  });
});
