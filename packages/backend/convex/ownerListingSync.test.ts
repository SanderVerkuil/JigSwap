import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SYNC_BATCH, SYNC_STALE_MS } from "./library/ownerListingVisibility";
import schema from "./schema";

// One profile visibility flip re-stamps every copy and re-counts every definition with an open one.
// Flips used to pile up: each started its own runs, however many were going. These tests run the
// scheduler by hand, because the flips that matter land while a run is under way.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
let t: T;
let me: Id<"users">;

const flip = (visibility: "public" | "private") =>
  t
    .withIdentity({ subject: "clerk_me" })
    .mutation(api.social.setProfileVisibility.setProfileVisibility, {
      visibility,
    });

const seedCopies = (count: number) =>
  t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: `Puzzle ${i}`,
        pieceCount: 1000,
        status: "approved",
        submittedBy: me,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: me,
        heldBy: me,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        isOpen: true,
        listedAt: 1000 + i,
        createdAt: 1000 + i,
        updatedAt: 1,
      });
    }
  });

// The scheduled jobs not yet run, by the function they call.
const pendingJobs = () =>
  t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs
      .filter((job) => job.state.kind === "pending")
      .map((job) => job.name);
  });
const pendingOf = async (name: string) =>
  (await pendingJobs()).filter((job) => job.includes(name)).length;

const everyJob = () =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).map(
      (job) => job.name,
    ),
  );

const copies = () => t.run((ctx) => ctx.db.query("ownedPuzzles").collect());
const profile = () =>
  t.run((ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", me))
      .unique(),
  );
const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);

beforeEach(async () => {
  vi.useFakeTimers();
  t = convexTest(schema, modules);
  me = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_me",
      email: "me@example.com",
      name: "Me",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a profile visibility change", () => {
  test("re-stamps the owner's copies and re-counts their definitions", async () => {
    await seedCopies(3);
    await flip("private");
    await settle();
    expect((await copies()).map((row) => row.ownerPrivate)).toEqual([
      true,
      true,
      true,
    ]);
    const stats = await t.run((ctx) =>
      ctx.db.query("definitionStats").collect(),
    );
    expect(stats).toHaveLength(3);
    expect(stats.every((row) => row.stale !== true)).toBe(true);
    expect((await profile())?.listingSyncSince).toBeUndefined();
  });

  test("flips that land before a run starts share it", async () => {
    await seedCopies(3);
    await flip("private");
    await flip("public");
    await flip("private");
    expect(await pendingOf("syncOwnerListings")).toBe(1);

    await settle();
    expect((await copies()).map((row) => row.ownerPrivate)).toEqual([
      true,
      true,
      true,
    ]);
    const jobs = await everyJob();
    expect(
      jobs.filter((job) => job.includes("syncOwnerListings")),
    ).toHaveLength(1);
    expect(
      jobs.filter((job) => job.includes("markOwnerListingsStale")),
    ).toHaveLength(1);
    expect(jobs.filter((job) => job.includes("recompute"))).toHaveLength(3);
  });

  test("flips that cancel out re-count nothing", async () => {
    await seedCopies(3);
    await flip("private");
    await flip("public");
    await settle();
    const jobs = await everyJob();
    expect(jobs.filter((job) => job.includes("recompute"))).toEqual([]);
    expect((await copies()).map((row) => row.ownerPrivate)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect((await profile())?.listingSyncSince).toBeUndefined();
  });

  test("a flip that lands during a run starts it over, and every copy ends on the latest value", async () => {
    await seedCopies(SYNC_BATCH + 5);
    await flip("private");
    // The first page goes through with the value the run started with.
    await t.mutation(
      internal.library.ownerListingVisibility.syncOwnerListings,
      {
        ownerId: me,
        ownerPrivate: true,
      },
    );
    const stamped = (await copies()).filter((row) => row.ownerPrivate === true);
    expect(stamped).toHaveLength(SYNC_BATCH);

    await flip("public");
    await settle();
    expect((await copies()).filter((row) => row.ownerPrivate === true)).toEqual(
      [],
    );
    expect((await profile())?.listingSyncSince).toBeUndefined();
  });

  test("a run that died doesn't block the next flip", async () => {
    await seedCopies(1);
    await flip("private");
    await settle();
    // A run marked long ago, whose job is gone.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .unique();
      await ctx.db.patch(row!._id, {
        listingSyncSince: Date.now() - SYNC_STALE_MS,
      });
    });
    await flip("public");
    await settle();
    const [row] = await copies();
    expect(row.ownerPrivate).toBeUndefined();
    expect((await profile())?.listingSyncSince).toBeUndefined();
  });

  test("a run scheduled before this change still finishes", async () => {
    await seedCopies(1);
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        aggregateId: "profile_me",
        memberId: me,
        visibility: "private",
        updatedAt: 1,
      }),
    );
    await t.mutation(
      internal.library.ownerListingVisibility.syncOwnerListings,
      {
        ownerId: me,
      },
    );
    const [row] = await copies();
    expect(row.ownerPrivate).toBe(true);
  });
});

describe("markOwnerListingsChange's reach", () => {
  test("the definitions of open copies are re-counted, closed copies' aren't", async () => {
    await seedCopies(1);
    await t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "On the shelf",
        pieceCount: 1000,
        status: "approved",
        submittedBy: me,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: me,
        heldBy: me,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        isOpen: false,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await flip("private");
    await settle();
    const jobs = await everyJob();
    expect(jobs.filter((job) => job.includes("recompute"))).toHaveLength(1);
  });
});
