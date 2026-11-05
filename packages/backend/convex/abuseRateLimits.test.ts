import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Public writes a free account could loop on: each bucket allows what a member would do by hand and
// refuses a script. A refused call writes nothing, and a refusal for another reason costs nothing.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
let t: T;
let me: Id<"users">;
const asMe = () => t.withIdentity({ subject: "clerk_me" });

beforeEach(async () => {
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

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const expectRateLimited = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data;
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  expect(parsed).toMatchObject({ code: "RateLimited" });
};

describe("createCollection", () => {
  const create = (name: string) =>
    asMe().mutation(api.library.createCollection.createCollection, { name });

  test("allows a day's worth and refuses the next one", async () => {
    for (let i = 0; i < RATE_LIMITS.collectionCreate.max; i++) {
      await create(`Collection ${i}`);
    }
    await expectRateLimited(create("One more"));
    const rows = await t.run((ctx) => ctx.db.query("collections").collect());
    expect(rows).toHaveLength(RATE_LIMITS.collectionCreate.max);
  });

  test("a refused name isn't charged", async () => {
    await create("Taken");
    await expect(create("Taken")).rejects.toThrow(/DuplicateCollectionName/);
    const row = await t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `collectionCreate:${me}`))
        .unique(),
    );
    expect(row?.count).toBe(1);
  });
});

describe("createPersonalCategory", () => {
  test("allows a day's worth and refuses the next one", async () => {
    const create = (name: string) =>
      asMe().mutation(
        api.library.createPersonalCategory.createPersonalCategory,
        { name },
      );
    for (let i = 0; i < RATE_LIMITS.categoryCreate.max; i++) {
      await create(`Category ${i}`);
    }
    await expectRateLimited(create("One more"));
    const rows = await t.run((ctx) => ctx.db.query("categories").collect());
    expect(rows).toHaveLength(RATE_LIMITS.categoryCreate.max);
  });
});

describe("updateCopySharing", () => {
  // The auditor's repro: Mallory's 200 close and reopen cycles put her copies ahead of Alice's.
  test("a close and reopen loop neither runs free nor climbs Browse", async () => {
    const now = Date.now();
    const { alice } = await t.run(async (ctx) => {
      const member = (name: string) =>
        ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        });
      const alice = await member("alice");
      const mallory = await member("mallory");
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        createdAt: 1,
        updatedAt: 1,
      });
      // Alice's offer is the newest, so a loop is the only way ahead of it.
      for (const [ownerId, aggregateId, listedAt] of [
        [alice, "copy_alice", now - 1000],
        [mallory, "copy_mallory", now - 2000],
      ] as const) {
        await ctx.db.insert("profiles", {
          aggregateId: `profile_${aggregateId}`,
          memberId: ownerId,
          visibility: "public",
          updatedAt: 1,
        });
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId,
          ownerId,
          heldBy: ownerId,
          condition: "good",
          availability: { forTrade: true, forSale: false, forLend: false },
          isOpen: true,
          listedAt,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return { alice };
    });
    const flip = (forTrade: boolean) =>
      t
        .withIdentity({ subject: "clerk_mallory" })
        .mutation(api.library.updateCopySharing.updateCopySharing, {
          copyId: "copy_mallory",
          forTrade,
        });

    for (let i = 0; i < RATE_LIMITS.copySharing.max; i += 2) {
      await flip(false);
      await flip(true);
    }
    await expectRateLimited(flip(false));

    const { ownedPuzzles } = await asMe().query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      { limit: 1 },
    );
    expect(ownedPuzzles[0].ownerId).toBe(alice);
  });
});

describe("setProfileVisibility", () => {
  const flip = (visibility: "public" | "private") =>
    asMe().mutation(api.social.setProfileVisibility.setProfileVisibility, {
      visibility,
    });

  test("allows an hour's worth and refuses the next one", async () => {
    for (let i = 0; i < RATE_LIMITS.profileVisibility.max; i++) {
      await flip(i % 2 === 0 ? "private" : "public");
    }
    await expectRateLimited(flip("private"));
    const row = await t.run((ctx) =>
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .unique(),
    );
    expect(row?.visibility).toBe("public");
  });
});

describe("sharing copies into a circle", () => {
  const BATCH = 100;
  const seedCopies = (count: number, from = 0) =>
    t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        submittedBy: me,
        createdAt: 1,
        updatedAt: 1,
      });
      const ids: string[] = [];
      for (let i = from; i < from + count; i++) {
        const aggregateId = `copy_${i}`;
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId,
          ownerId: me,
          heldBy: me,
          condition: "good",
          availability: { forTrade: true, forSale: false, forLend: false },
          createdAt: 1,
          updatedAt: 1,
        });
        ids.push(aggregateId);
      }
      return ids;
    });
  const newCircle = () =>
    asMe().mutation(api.sharing.createCircle.createCircle, { name: "Friends" });
  const share = (circleId: string, copyIds: string[]) =>
    asMe().mutation(api.sharing.shareCopiesToCircle.shareCopiesToCircle, {
      circleId,
      copyIds,
    });
  const usedToday = async () =>
    (
      await t.run((ctx) =>
        ctx.db
          .query("rateLimits")
          .withIndex("by_key", (q) => q.eq("key", `circleShare:${me}`))
          .unique(),
      )
    )?.count ?? 0;
  // The budget, nearly spent, without sharing it all.
  const spend = (count: number) =>
    t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `circleShare:${me}`,
        windowStart: Date.now(),
        count,
      }),
    );

  test("each copy shared is charged; copies already there aren't", async () => {
    const copies = await seedCopies(3);
    const circleId = await newCircle();
    await share(circleId, copies.slice(0, 2));
    expect(await usedToday()).toBe(2);
    await share(circleId, copies);
    expect(await usedToday()).toBe(3);
    await share(circleId, copies);
    expect(await usedToday()).toBe(3);
  });

  test("a batch that doesn't fit today is refused whole", async () => {
    const copies = await seedCopies(BATCH);
    const circleId = await newCircle();
    await spend(RATE_LIMITS.circleShare.max - BATCH + 1);
    await expectRateLimited(share(circleId, copies));
    expect(
      await t.run((ctx) => ctx.db.query("circleCopyShares").collect()),
    ).toEqual([]);
    await share(circleId, copies.slice(0, BATCH - 1));
    expect(await usedToday()).toBe(RATE_LIMITS.circleShare.max);
    expect(
      await t.run((ctx) => ctx.db.query("circleCopyShares").collect()),
    ).toHaveLength(BATCH - 1);
  });

  test("sharing one copy at a time draws on the same budget", async () => {
    const [copyId] = await seedCopies(1);
    const circleId = await newCircle();
    await spend(RATE_LIMITS.circleShare.max);
    await expectRateLimited(
      asMe().mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
        circleId,
        copyId,
      }),
    );
  });

  test("createCircle allows a day's worth and refuses the next one", async () => {
    for (let i = 0; i < RATE_LIMITS.circleCreate.max; i++) await newCircle();
    await expectRateLimited(newCircle());
    const circles = await t.run((ctx) => ctx.db.query("circles").collect());
    expect(circles).toHaveLength(RATE_LIMITS.circleCreate.max);
  });
});
