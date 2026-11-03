import { MAX_HOUSEHOLD_PERMISSION_BATCH } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import { HOUSEHOLD_PERMISSION_ROWS_PER_CHARGE } from "./library/setCopiesHouseholdPermission";
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

// Every copy edit patches the row, inside the listing range each Browse first page reads, and most
// publish a domain event, so a loop mustn't be free. One bucket across them: a dialog save can make
// three of these calls at once. The bulk form of the household permission shares it too, or it would
// be the way around it.
describe("copy edits", () => {
  const CAP = RATE_LIMITS.copyEdit.max;
  let copy: Id<"ownedPuzzles">;
  let photo: Id<"ownedPuzzleImages">;

  beforeEach(async () => {
    ({ copy, photo } = await t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: me,
        createdAt: 1,
        updatedAt: 1,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy_me",
        puzzleId,
        ownerId: me,
        heldBy: me,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        isOpen: true,
        listedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const photo = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: me,
        fileId: await ctx.storage.store(new Blob(["x"])),
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("households", { aggregateId: "hh", createdAt: 1 });
      await ctx.db.insert("householdMembers", {
        householdId: "hh",
        memberId: me,
        role: "admin",
        joinedAt: 1,
      });
      return { copy, photo };
    }));
  });

  const edits = {
    updateCopyDetails: (i: number) =>
      asMe().mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy_me",
        notes: `note ${i}`,
      }),
    changeCopyCondition: (i: number) =>
      asMe().mutation(api.library.changeCopyCondition.changeCopyCondition, {
        copyId: "copy_me",
        condition: i % 2 === 0 ? "fair" : "good",
      }),
    setCopyCover: (i: number) =>
      asMe().mutation(api.library.setCopyCover.setCopyCover, {
        copyId: copy,
        ...(i % 2 === 0 ? { coverImageId: photo } : {}),
      }),
    setCopyHouseholdPermission: (i: number) =>
      asMe().mutation(
        api.library.setCopyHouseholdPermission.setCopyHouseholdPermission,
        { copyId: copy, permission: i % 2 === 0 ? "view" : "manage" },
      ),
    setCopiesHouseholdPermission: (i: number) =>
      asMe().mutation(
        api.library.setCopiesHouseholdPermission.setCopiesHouseholdPermission,
        { copyIds: [copy], permission: i % 2 === 0 ? "view" : "manage" },
      ),
  };

  test.each(Object.entries(edits))(
    "%s allows a minute's worth and refuses the next, writing nothing",
    async (_name, edit) => {
      for (let i = 0; i < CAP; i++) await edit(i);
      const before = await t.run((ctx) => ctx.db.get(copy));

      await expectRateLimited(edit(CAP));

      expect(await t.run((ctx) => ctx.db.get(copy))).toEqual(before);
    },
  );

  test("they draw on one bucket, and it fills again after the window", async () => {
    const all = Object.values(edits);
    for (let i = 0; i < CAP; i++) await all[i % all.length](i);
    for (const edit of all) await expectRateLimited(edit(CAP));

    await t.run(async (ctx) => {
      const row = await ctx.db.query("rateLimits").first();
      await ctx.db.patch(row!._id, {
        windowStart: Date.now() - RATE_LIMITS.copyEdit.windowMs,
      });
    });
    await edits.updateCopyDetails(CAP);
  });

  test("an edit refused for another reason isn't charged", async () => {
    const refused = () =>
      asMe().mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "no_such_copy",
        notes: "nothing to write to",
      });
    for (let i = 0; i < CAP; i++) await expect(refused()).rejects.toThrow();
    await edits.updateCopyDetails(0);
  });

  // One bulk call can write 200 rows, so at a token a call a loop patches 6,000 rows a minute against
  // the single form's 30, and the bulk form would be the way around the limit.
  describe("the bulk household permission pays for what it writes", () => {
    const seedShelf = async () => {
      const row = (await t.run((ctx) => ctx.db.get(copy)))!;
      const more = await t.run(async (ctx) => {
        const ids = [];
        for (let i = 0; i < MAX_HOUSEHOLD_PERMISSION_BATCH - 1; i++) {
          ids.push(
            await ctx.db.insert("ownedPuzzles", {
              aggregateId: `copy_${i}`,
              puzzleId: row.puzzleId,
              ownerId: me,
              heldBy: me,
              condition: "good",
              availability: { forTrade: false, forSale: false, forLend: false },
              createdAt: 1,
              updatedAt: 1,
            }),
          );
        }
        return ids;
      });
      return [copy, ...more];
    };
    const setAll = (
      copyIds: Id<"ownedPuzzles">[],
      permission: "view" | "manage",
    ) =>
      asMe().mutation(
        api.library.setCopiesHouseholdPermission.setCopiesHouseholdPermission,
        { copyIds, permission },
      );

    test("a member can still change a whole batch, three times a minute", async () => {
      const shelf = await seedShelf();
      const perBatch = Math.ceil(
        MAX_HOUSEHOLD_PERMISSION_BATCH / HOUSEHOLD_PERMISSION_ROWS_PER_CHARGE,
      );
      expect(Math.floor(CAP / perBatch)).toBe(3);

      expect((await setAll(shelf, "view")).changed).toBe(shelf.length);
      await setAll(shelf, "manage");
      await setAll(shelf, "view");

      await expectRateLimited(setAll(shelf, "manage"));
      const left = await t.run((ctx) => ctx.db.get(shelf[0]));
      expect(left?.householdPermission).toBe("view");
    });

    test("what is left of the minute still pays for a small change", async () => {
      const shelf = await seedShelf();
      await setAll(shelf, "view");
      await setAll(shelf, "manage");
      await setAll(shelf, "view");
      expect((await setAll(shelf.slice(0, 25), "manage")).changed).toBe(25);
    });

    test("a batch that changes nothing costs one, like any call", async () => {
      const shelf = await seedShelf();
      await setAll(shelf, "view");
      for (let i = 0; i < CAP - 8; i++) {
        expect((await setAll(shelf, "view")).changed).toBe(0);
      }
      await expectRateLimited(setAll(shelf, "view"));
    });
  });
});

// Every page showing a member reads their profile row, so a loop re-runs all of them.
describe("editProfile", () => {
  const CAP = RATE_LIMITS.profileEdit.max;
  const edit = (bio: string) =>
    asMe().mutation(api.social.editProfile.editProfile, { bio });
  const myProfile = () =>
    t.run((ctx) =>
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", me))
        .unique(),
    );

  test("allows a minute's worth and refuses the next, writing nothing", async () => {
    for (let i = 0; i < CAP; i++) await edit(`Story ${i}`);
    const before = await myProfile();

    await expectRateLimited(edit("One more"));

    expect(await myProfile()).toEqual(before);
  });

  test("fills again after the window", async () => {
    for (let i = 0; i < CAP; i++) await edit(`Story ${i}`);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("rateLimits").first();
      await ctx.db.patch(row!._id, {
        windowStart: Date.now() - RATE_LIMITS.profileEdit.windowMs,
      });
    });
    await edit("Back again");
    expect((await myProfile())?.bio).toBe("Back again");
  });

  test("an edit refused for another reason isn't charged", async () => {
    const tooLong = "x".repeat(10_000);
    for (let i = 0; i < CAP; i++) await expect(edit(tooLong)).rejects.toThrow();
    await edit("Short");
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
