import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// library.myShelf: the signed-in member's own shelf summary for the dashboard and profile
// shelves (PERF-B5q). Counts span the whole library (private copies included); only the newest
// `limit` copies are joined.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const closed = { forTrade: false, forSale: false, forLend: false };

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
}

const seed = (t: T): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await user("ann");
    const bob = await user("bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    // Ann and Bob share a household: a mate's copies are still not Ann's shelf.
    for (const memberId of [ann, bob]) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh-1",
        memberId,
        role: memberId === ann ? "admin" : "member",
        joinedAt: now,
      });
    }
    return { ann, bob, puzzleId };
  });

// Inserts a copy for `ownerId` created at `createdAt` (insertion order deliberately differs from
// createdAt order in the tests, so newest-first must come from createdAt).
const addCopy = (
  t: T,
  w: World,
  ownerId: Id<"users">,
  createdAt: number,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId: w.puzzleId,
      ownerId,
      condition: "good",
      availability: closed,
      createdAt,
      updatedAt: createdAt,
      ...extra,
    }),
  );

const shelfOf = (t: T, who: string, limit?: number) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(
      api.library.getMyShelf.getMyShelf,
      limit === undefined ? {} : { limit },
    );

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("library.myShelf", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.library.getMyShelf.getMyShelf, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("counts every own copy, private and closed included, and only the caller's", async () => {
    await addCopy(t, w, w.ann, 1, {
      availability: { forTrade: true, forSale: false, forLend: false },
    });
    await addCopy(t, w, w.ann, 2, {
      availability: { forTrade: true, forSale: true, forLend: false },
    });
    await addCopy(t, w, w.ann, 3, {
      availability: { forTrade: false, forSale: true, forLend: false },
    });
    await addCopy(t, w, w.ann, 4, {
      visibility: "private",
      visibilityAuthoritative: true,
    });
    await addCopy(t, w, w.ann, 5);
    await addCopy(t, w, w.bob, 6, {
      availability: { forTrade: true, forSale: false, forLend: false },
    });

    const shelf = await shelfOf(t, "ann");
    expect(shelf.total).toBe(5);
    expect(shelf.forTrade).toBe(2);
    expect(shelf.recent.every((copy) => copy.ownerId === w.ann)).toBe(true);

    const bobs = await shelfOf(t, "bob");
    expect(bobs.total).toBe(1);
    expect(bobs.forTrade).toBe(1);
  });

  test("joins only the newest copies by createdAt, newest first, with owner-only fields", async () => {
    const ids = new Map<number, Id<"ownedPuzzles">>();
    for (const createdAt of [30, 10, 50, 20, 40, 70, 60, 80]) {
      ids.set(
        createdAt,
        await addCopy(t, w, w.ann, createdAt, { notes: `note ${createdAt}` }),
      );
    }

    const shelf = await shelfOf(t, "ann", 3);
    expect(shelf.total).toBe(8);
    expect(shelf.recent.map((copy) => copy._id)).toEqual([
      ids.get(80),
      ids.get(70),
      ids.get(60),
    ]);
    expect(shelf.recent[0].notes).toBe("note 80");
    expect(shelf.recent[0].puzzle?.title).toBe("Harbour Lights");
    expect(shelf.recent[0]).toHaveProperty("coverUrl");
  });

  test("an empty library is an empty shelf", async () => {
    expect(await shelfOf(t, "ann")).toEqual({
      total: 0,
      forTrade: 0,
      recent: [],
    });
  });

  test("clamps the requested size: default 6, at most 12, at least 1", async () => {
    for (let i = 1; i <= 15; i++) await addCopy(t, w, w.ann, i);

    expect((await shelfOf(t, "ann")).recent).toHaveLength(6);
    expect((await shelfOf(t, "ann", Number.NaN)).recent).toHaveLength(6);
    expect((await shelfOf(t, "ann", 1e6)).recent).toHaveLength(12);
    expect((await shelfOf(t, "ann", 0)).recent).toHaveLength(1);
    expect((await shelfOf(t, "ann", -3)).recent).toHaveLength(1);
    expect((await shelfOf(t, "ann", 4.9)).recent).toHaveLength(4);
    expect((await shelfOf(t, "ann", 1e6)).total).toBe(15);
  });
});
