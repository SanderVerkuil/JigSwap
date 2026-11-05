import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { moderationPool } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// Every copy or completion photo runs the paid moderation pipeline (classifier, CSAM hash check),
// so each member has one photo bucket for both ways in (library/addCopyPhoto,
// solving/attachCompletionPhotos): RATE_LIMITS.photoAttach (40 an hour) and photoAttachDaily (150
// a day), one charge per newly attached photo (SEC-19). A refusal leaves no photo row and no
// moderation job.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  // No provider calls from the moderation jobs these photos enqueue.
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "none");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Alice owns a copy (domain-shaped, so every photo path accepts it); Bob shares her household,
// which leaves her copies at "manage" (co-owner); Cat is an outsider.
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
    const bob = await mkUser("clerk_bob");
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
      visibility: "private",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const householdId = crypto.randomUUID();
    await ctx.db.insert("households", {
      aggregateId: householdId,
      createdAt: now,
    });
    for (const memberId of [alice, bob]) {
      await ctx.db.insert("householdMembers", {
        householdId,
        memberId,
        role: memberId === alice ? "admin" : "member",
        joinedAt: now,
      });
    }
    return { alice, bob, copy, copyAggregateId };
  });

const as = (t: TestConvex<typeof schema>, who: "alice" | "bob") =>
  t.withIdentity({ subject: `clerk_${who}` });

const storeBlob = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.storage.store(
      new Blob([crypto.randomUUID()], { type: "application/octet-stream" }),
    ),
  ) as Promise<Id<"_storage">>;

const seedBucket = (t: TestConvex<typeof schema>, key: string, count: number) =>
  t.run((ctx) =>
    ctx.db.insert("rateLimits", { key, windowStart: Date.now(), count }),
  );

const buckets = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("rateLimits").collect()).map((row) => [
        row.key,
        row.count,
      ]),
    ),
  );

const copyPhotoCount = (t: TestConvex<typeof schema>) =>
  t.run(
    async (ctx) => (await ctx.db.query("ownedPuzzleImages").collect()).length,
  );
const completionPhotoCount = (t: TestConvex<typeof schema>) =>
  t.run(
    async (ctx) => (await ctx.db.query("completionImages").collect()).length,
  );

// convex-test may hand ConvexError.data over as a JSON string; normalise.
const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    const data = (error as ConvexError<Value>).data;
    return (typeof data === "string" ? JSON.parse(data) : data) as {
      code?: string;
      retryAfterMs?: number;
    };
  }
  throw new Error("expected a refusal");
};

const addCopyPhoto = async (
  t: TestConvex<typeof schema>,
  who: "alice" | "bob",
  copy: Id<"ownedPuzzles">,
) =>
  as(t, who).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId: await storeBlob(t),
  });

const recordCompletion = async (
  t: TestConvex<typeof schema>,
  copyAggregateId: string,
) =>
  (
    await as(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    )
  ).completionId;

const attachCompletionPhotos = async (
  t: TestConvex<typeof schema>,
  completionId: string,
  count: number,
) => {
  const storageIds = [];
  for (let i = 0; i < count; i++) storageIds.push(await storeBlob(t));
  return as(t, "alice").mutation(
    api.solving.attachCompletionPhotos.attachCompletionPhotos,
    { completionId, storageIds },
  );
};

describe("the shared photo bucket", () => {
  test("the 41st copy photo in an hour is refused, with no row and no moderation job", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    await seedBucket(t, `photoAttach:${alice}`, 39);
    const enqueues = vi.spyOn(moderationPool, "enqueueAction");

    await addCopyPhoto(t, "alice", copy);
    expect(enqueues).toHaveBeenCalledTimes(1);

    const refusal = await refusalOf(addCopyPhoto(t, "alice", copy));
    expect(refusal.code).toBe("RateLimited");
    expect(refusal.retryAfterMs).toBeGreaterThan(0);
    expect(enqueues).toHaveBeenCalledTimes(1);
    expect(await copyPhotoCount(t)).toBe(1);
    expect(await buckets(t)).toMatchObject({
      [`photoAttach:${alice}`]: 40,
      [`photoAttachDaily:${alice}`]: 1,
    });
    await settleDueScheduled(t);
  });

  test("completion photos are charged one each, and a refusal attaches none of the batch", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copyAggregateId } = await seed(t);
    const completionId = await recordCompletion(t, copyAggregateId);
    await seedBucket(t, `photoAttach:${alice}`, 37);

    // Three new photos with room for three: all attached, the bucket full.
    await attachCompletionPhotos(t, completionId, 3);
    expect(await completionPhotoCount(t)).toBe(3);
    expect(await buckets(t)).toMatchObject({
      [`photoAttach:${alice}`]: 40,
      [`photoAttachDaily:${alice}`]: 3,
    });

    // Two more with no room: neither is attached, nothing charged.
    expect(
      (await refusalOf(attachCompletionPhotos(t, completionId, 2))).code,
    ).toBe("RateLimited");
    expect(await completionPhotoCount(t)).toBe(3);
    const row = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(row?.photos).toHaveLength(3);
    expect(await buckets(t)).toMatchObject({
      [`photoAttach:${alice}`]: 40,
      [`photoAttachDaily:${alice}`]: 3,
    });
    await settleDueScheduled(t);
  });

  test("a full bucket refuses completion photos too", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copyAggregateId } = await seed(t);
    const completionId = await recordCompletion(t, copyAggregateId);
    await seedBucket(t, `photoAttach:${alice}`, 40);

    expect(
      (await refusalOf(attachCompletionPhotos(t, completionId, 1))).code,
    ).toBe("RateLimited");
    expect(await completionPhotoCount(t)).toBe(0);
  });

  test("re-sending photos that are already attached costs nothing", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copyAggregateId } = await seed(t);
    const completionId = await recordCompletion(t, copyAggregateId);
    const storageIds = [await storeBlob(t)];
    const attach = () =>
      as(t, "alice").mutation(
        api.solving.attachCompletionPhotos.attachCompletionPhotos,
        { completionId, storageIds },
      );

    await attach();
    await attach();
    expect(await buckets(t)).toMatchObject({
      [`photoAttach:${alice}`]: 1,
      [`photoAttachDaily:${alice}`]: 1,
    });
    await settleDueScheduled(t);
  });

  test("the daily bucket holds a member to 150 photos a day", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    await seedBucket(t, `photoAttachDaily:${alice}`, 150);

    expect((await refusalOf(addCopyPhoto(t, "alice", copy))).code).toBe(
      "RateLimited",
    );
    expect(await copyPhotoCount(t)).toBe(0);
  });

  test("a household co-owner's photo is charged to the co-owner, not the copy's owner", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, bob, copy } = await seed(t);
    await seedBucket(t, `photoAttach:${alice}`, 40);

    await addCopyPhoto(t, "bob", copy);

    expect(await copyPhotoCount(t)).toBe(1);
    expect(await buckets(t)).toMatchObject({
      [`photoAttach:${alice}`]: 40,
      [`photoAttach:${bob}`]: 1,
      [`photoAttachDaily:${bob}`]: 1,
    });
    await settleDueScheduled(t);
  });
});
