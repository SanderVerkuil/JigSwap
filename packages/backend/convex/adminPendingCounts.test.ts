import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PENDING_COUNT_CAP } from "./admin/getPendingCounts";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// admin/getPendingCounts: the bounded "work waiting" counts behind the moderation tab pills, the
// admin sidebar badges and the /admin hub tiles. Each queue counts only what still needs an admin,
// stops at PENDING_COUNT_CAP (then `capped`), and only an admin may read any of it.

type World = {
  alice: Id<"users">;
  copyId: Id<"ownedPuzzles">;
  puzzleId: Id<"puzzles">;
};

const seedWorld = (t: TestConvex<typeof schema>): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("users", {
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
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      snapshot: { title: "Starry Night", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, copyId, puzzleId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const counts = (t: TestConvex<typeof schema>) =>
  asAdmin(t).query(api.admin.getPendingCounts.getPendingCounts, {});

const submissions = (
  t: TestConvex<typeof schema>,
  { alice }: World,
  status: "pending" | "approved" | "rejected" | "disabled",
  n: number,
) =>
  t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("puzzles", {
        title: `${status} ${i}`,
        pieceCount: 500,
        status,
        submittedBy: alice,
        createdAt: i,
        updatedAt: i,
      });
    }
  });

const copyPhoto = (
  t: TestConvex<typeof schema>,
  { alice, copyId }: World,
  moderationStatus: "pending" | "approved" | "rejected",
) =>
  t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
    await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: alice,
      fileId,
      moderationStatus,
      createdAt: 1,
      updatedAt: 1,
    });
  });

const messagePhoto = (
  t: TestConvex<typeof schema>,
  { alice }: World,
  fields: {
    moderationStatus: "rejected" | "quarantined" | "approved" | "pending";
    reviewRequestedAt?: number;
    reviewDecidedAt?: number;
  },
) =>
  t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
    await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: "thread-1",
      uploaderId: alice,
      fileId,
      byteSize: 4,
      contentType: "image/jpeg",
      ...fields,
      createdAt: 1,
      updatedAt: 1,
    });
  });

const report = (
  t: TestConvex<typeof schema>,
  { alice }: World,
  status: "open" | "actioned" | "dismissed",
) =>
  t.run((ctx) =>
    ctx.db.insert("reports", {
      reporterId: alice,
      targetKind: "user",
      targetId: alice,
      reportedUserId: alice,
      reason: "spam_scam",
      evidence: {},
      status,
      createdAt: 1,
    }),
  );

const hashMatch = (
  t: TestConvex<typeof schema>,
  { alice }: World,
  status: "open" | "reported" | "closed",
) =>
  t.run((ctx) =>
    ctx.db.insert("csamEscalations", {
      table: "ownedPuzzleImages",
      rowId: "row-1",
      uploaderId: alice,
      md5: "md5",
      sha1: "sha1",
      provider: "test",
      matchedAt: 1,
      status,
    }),
  );

const contact = (t: TestConvex<typeof schema>, status: "new" | "handled") =>
  t.run((ctx) =>
    ctx.db.insert("contactMessages", {
      name: "Mara",
      email: "mara@example.com",
      subject: "other",
      message: "Hello",
      status,
      createdAt: 1,
    }),
  );

const proposal = (
  t: TestConvex<typeof schema>,
  { alice }: World,
  status: "pending" | "approved" | "rejected",
) =>
  t.run((ctx) =>
    ctx.db.insert("puzzleChangeProposals", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: "definition-1",
      proposedBy: alice,
      status,
      changes: { title: "New title" },
      baseline: { title: "Starry Night" },
      createdAt: 1,
      updatedAt: 1,
    }),
  );

const ZERO = { count: 0, capped: false };

describe("admin/getPendingCounts", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    await expect(
      t.query(api.admin.getPendingCounts.getPendingCounts, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    await expect(
      asAlice(t).query(api.admin.getPendingCounts.getPendingCounts, {}),
    ).rejects.toThrow(/Forbidden/);
  });

  test("an empty deployment has nothing waiting", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect(await counts(t)).toEqual({
      submissions: ZERO,
      flagged: ZERO,
      appeals: ZERO,
      reports: ZERO,
      hashMatches: ZERO,
      contact: ZERO,
      proposals: ZERO,
    });
  });

  test("counts only the items each queue still has to decide", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await submissions(t, world, "pending", 2);
    await submissions(t, world, "rejected", 1);
    await submissions(t, world, "disabled", 1);
    await copyPhoto(t, world, "rejected");
    await copyPhoto(t, world, "approved");
    await copyPhoto(t, world, "pending");
    // Review requests: only a rejected photo whose review was asked and not yet decided.
    await messagePhoto(t, world, {
      moderationStatus: "rejected",
      reviewRequestedAt: 5,
    });
    await messagePhoto(t, world, {
      moderationStatus: "rejected",
      reviewRequestedAt: 6,
    });
    await messagePhoto(t, world, { moderationStatus: "rejected" });
    await messagePhoto(t, world, {
      moderationStatus: "rejected",
      reviewRequestedAt: 7,
      reviewDecidedAt: 8,
    });
    await messagePhoto(t, world, {
      moderationStatus: "approved",
      reviewRequestedAt: 7,
      reviewDecidedAt: 8,
    });
    // A quarantined photo takes the request, but no admin may ever see or decide it.
    await messagePhoto(t, world, {
      moderationStatus: "quarantined",
      reviewRequestedAt: 9,
    });
    await report(t, world, "open");
    await report(t, world, "actioned");
    await report(t, world, "dismissed");
    await hashMatch(t, world, "open");
    await hashMatch(t, world, "reported");
    await hashMatch(t, world, "closed");
    await contact(t, "new");
    await contact(t, "new");
    await contact(t, "handled");
    await proposal(t, world, "pending");
    await proposal(t, world, "approved");

    expect(await counts(t)).toEqual({
      submissions: { count: 2, capped: false },
      flagged: { count: 1, capped: false },
      appeals: { count: 2, capped: false },
      reports: { count: 1, capped: false },
      hashMatches: { count: 1, capped: false },
      contact: { count: 2, capped: false },
      proposals: { count: 1, capped: false },
    });
  });

  test("the review-request count agrees with the admin's review queue", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await messagePhoto(t, world, {
      moderationStatus: "rejected",
      reviewRequestedAt: 5,
    });
    await messagePhoto(t, world, {
      moderationStatus: "rejected",
      reviewRequestedAt: 7,
      reviewDecidedAt: 8,
    });
    const queue = await asAdmin(t).query(
      api.admin.listImageReviewRequests.listImageReviewRequests,
      {},
    );
    expect((await counts(t)).appeals.count).toBe(queue.length);
  });

  test("stops at the cap and says so", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await submissions(t, world, "pending", PENDING_COUNT_CAP);
    expect((await counts(t)).submissions).toEqual({
      count: PENDING_COUNT_CAP,
      capped: false,
    });
    await submissions(t, world, "pending", 2);
    expect((await counts(t)).submissions).toEqual({
      count: PENDING_COUNT_CAP,
      capped: true,
    });
  });
});
