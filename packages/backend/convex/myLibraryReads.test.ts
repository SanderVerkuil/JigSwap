import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { LIBRARY_INDEX_CAP, LIBRARY_WINDOW_MAX } from "./library/myLibraryRows";
import schema from "./schema";

// My Puzzles and the household's Puzzles tab, paged (PERF-B5q): the first rows through
// library.myLibraryWindow, a lean whole-library index for what only the whole library can answer
// (search, sort, status pills, select all), and the full rows for just what's on screen through
// library.myLibraryCopies.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const closed = { forTrade: false, forSale: false, forLend: false };
const swap = { forTrade: true, forSale: false, forLend: false };

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  cleo: Id<"users">;
  eve: Id<"users">;
  puzzleId: Id<"puzzles">;
  pendingPuzzleId: Id<"puzzles">;
}

// Ann and Bob share a household (Cleo too, in the tests that add her). Eve is a stranger.
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
    const cleo = await user("cleo");
    const eve = await user("eve");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      brand: "Ravensburger",
      tags: ["boats"],
      pieceCount: 1000,
      status: "approved",
      submittedBy: eve,
      createdAt: now,
      updatedAt: now,
    });
    const pendingPuzzleId = await ctx.db.insert("puzzles", {
      title: "A title still in review",
      pieceCount: 500,
      status: "pending",
      submittedBy: eve,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("households", {
      aggregateId: "hh-1",
      createdAt: now,
    });
    for (const memberId of [ann, bob]) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh-1",
        memberId,
        role: memberId === ann ? "admin" : "member",
        joinedAt: now,
      });
    }
    return { ann, bob, cleo, eve, puzzleId, pendingPuzzleId };
  });

const addCopy = (
  t: T,
  w: World,
  ownerId: Id<"users">,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId: w.puzzleId,
      ownerId,
      condition: "good",
      availability: closed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }),
  );

const windowOf = (
  t: T,
  who: string,
  args: {
    limit: number;
    owner?: "all" | "mine" | "household";
    memberId?: Id<"users">;
  },
) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.library.listMyLibraryWindow.listMyLibraryWindow, args);

const indexOf = (t: T, who: string) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.library.listMyLibraryIndex.listMyLibraryIndex, {});

const copiesOf = (t: T, who: string, copyIds: Id<"ownedPuzzles">[]) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.library.getMyLibraryCopies.getMyLibraryCopies, { copyIds });

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("library.myLibraryWindow", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.library.listMyLibraryWindow.listMyLibraryWindow, {
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("the newest copies first, as far as the limit, and says when there are more", async () => {
    const ids = [
      await addCopy(t, w, w.ann, { notes: "first" }),
      await addCopy(t, w, w.ann),
      await addCopy(t, w, w.ann),
    ];

    const partial = await windowOf(t, "ann", { limit: 2 });
    expect(partial.rows.map((row) => row._id)).toEqual([ids[2], ids[1]]);
    expect(partial.hasMore).toBe(true);

    const whole = await windowOf(t, "ann", { limit: 3 });
    expect(whole.rows.map((row) => row._id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(whole.hasMore).toBe(false);
    // Your own copy carries its owner-only fields and no household tag.
    expect(whole.rows[2].notes).toBe("first");
    expect(whole.rows[2].household).toBeUndefined();
    expect(whole.rows[2].puzzle?.title).toBe("Harbour Lights");
    expect(whole.rows[2]).toHaveProperty("coverUrl");
  });

  test("merges a housemate's copies by age and tags them with their owner and your access", async () => {
    const mine = await addCopy(t, w, w.ann);
    const theirs = await addCopy(t, w, w.bob, { notes: "bob's note" });
    const mineLater = await addCopy(t, w, w.ann);

    const { rows, hasMore, matched, total } = await windowOf(t, "ann", {
      limit: 10,
    });
    expect(rows.map((row) => row._id)).toEqual([mineLater, theirs, mine]);
    expect(hasMore).toBe(false);
    expect(matched).toBe(3);
    expect(total).toBe(3);
    const bobs = rows[1];
    expect(bobs.household?.owner.memberId).toBe(w.bob);
    expect(bobs.household?.viewerAccess).toBe("manage");
    expect(bobs.notes).toBe("bob's note");
  });

  test("a copy left at view strips the owner-only fields", async () => {
    await addCopy(t, w, w.bob, {
      notes: "bob's note",
      householdPermission: "view",
    });
    const { rows } = await windowOf(t, "ann", { limit: 10 });
    expect(rows[0].household?.viewerAccess).toBe("view");
    expect(rows[0].notes).toBeUndefined();
  });

  test("the owner filter narrows the rows and the matched count, not the total", async () => {
    const mine = await addCopy(t, w, w.ann);
    const theirs = await addCopy(t, w, w.bob);

    const own = await windowOf(t, "ann", { limit: 10, owner: "mine" });
    expect(own.rows.map((row) => row._id)).toEqual([mine]);
    expect(own.matched).toBe(1);
    expect(own.total).toBe(2);

    const housemates = await windowOf(t, "ann", {
      limit: 10,
      owner: "household",
    });
    expect(housemates.rows.map((row) => row._id)).toEqual([theirs]);
    expect(housemates.matched).toBe(1);
    expect(housemates.total).toBe(2);
  });

  test("one household member by id; anyone else's library stays out", async () => {
    const theirs = await addCopy(t, w, w.bob);
    const strangers = await addCopy(t, w, w.eve, { availability: swap });

    const bob = await windowOf(t, "ann", { limit: 10, memberId: w.bob });
    expect(bob.rows.map((row) => row._id)).toEqual([theirs]);

    const eve = await windowOf(t, "ann", { limit: 10, memberId: w.eve });
    expect(eve.rows).toEqual([]);
    expect(eve.hasMore).toBe(false);
    expect(eve.matched).toBe(0);

    const all = await windowOf(t, "ann", { limit: 10 });
    expect(all.rows.map((row) => row._id)).not.toContain(strangers);
  });

  test("without a household only your own copies", async () => {
    const mine = await addCopy(t, w, w.eve);
    await addCopy(t, w, w.ann);
    const { rows, matched, total } = await windowOf(t, "eve", { limit: 10 });
    expect(rows.map((row) => row._id)).toEqual([mine]);
    expect(matched).toBe(1);
    expect(total).toBe(1);
  });

  test("the counts come from the counters when there are any", async () => {
    await addCopy(t, w, w.ann);
    await t.run((ctx) =>
      ctx.db.insert("memberLibraryCounts", {
        memberId: w.ann,
        owned: 40,
        forTrade: 3,
      }),
    );
    const { total, matched } = await windowOf(t, "ann", { limit: 10 });
    expect(total).toBe(40);
    expect(matched).toBe(40);
  });

  test("clamps the limit", async () => {
    await addCopy(t, w, w.ann);
    await addCopy(t, w, w.ann);
    expect((await windowOf(t, "ann", { limit: 0 })).rows).toHaveLength(1);
    expect((await windowOf(t, "ann", { limit: Number.NaN })).rows).toHaveLength(
      2,
    );
    expect(LIBRARY_WINDOW_MAX).toBeGreaterThanOrEqual(48);
  });
});

describe("library.myLibraryIndex", () => {
  test("one lean row per copy of yours and your housemates', with what filtering and bulk actions need", async () => {
    const mine = await addCopy(t, w, w.ann, {
      aggregateId: "copy-1",
      availability: swap,
      notes: "secret",
      visibility: "private",
      visibilityAuthoritative: true,
    });
    const theirs = await addCopy(t, w, w.bob, {
      householdPermission: "view",
    });
    await addCopy(t, w, w.eve);

    const rows = await indexOf(t, "ann");
    expect(rows.map((row) => row._id).sort()).toEqual([mine, theirs].sort());
    const own = rows.find((row) => row._id === mine)!;
    expect(own).toMatchObject({
      aggregateId: "copy-1",
      ownerId: w.ann,
      availability: swap,
      puzzle: {
        title: "Harbour Lights",
        brand: "Ravensburger",
        tags: ["boats"],
        pieceCount: 1000,
      },
    });
    expect(own.viewerAccess).toBeUndefined();
    expect(own).not.toHaveProperty("notes");
    expect(own).not.toHaveProperty("coverUrl");
    expect(rows.find((row) => row._id === theirs)?.viewerAccess).toBe("view");
  });

  test("a housemate's copy of a definition still in review shows only its snapshot facts", async () => {
    await addCopy(t, w, w.bob, {
      puzzleId: w.pendingPuzzleId,
      householdPermission: "view",
      snapshot: { title: "Snapshot title", pieceCount: 500 },
    });
    const [row] = await indexOf(t, "ann");
    expect(row.puzzle?.title).toBe("Snapshot title");
  });

  test("past the cap the newest copies stay", async () => {
    const ids = await t.run(async (ctx) => {
      const out: Id<"ownedPuzzles">[] = [];
      for (let i = 0; i <= LIBRARY_INDEX_CAP; i++) {
        out.push(
          await ctx.db.insert("ownedPuzzles", {
            puzzleId: w.puzzleId,
            ownerId: w.ann,
            condition: "good",
            availability: closed,
            createdAt: i,
            updatedAt: i,
          }),
        );
      }
      return out;
    });
    const rows = await indexOf(t, "ann");
    expect(rows).toHaveLength(LIBRARY_INDEX_CAP);
    expect(rows.map((row) => row._id)).toContain(ids[LIBRARY_INDEX_CAP]);
    expect(rows.map((row) => row._id)).not.toContain(ids[0]);
  });
});

describe("library.myLibraryCopies", () => {
  test("the full rows of the ids asked for, in that order", async () => {
    const a = await addCopy(t, w, w.ann, { notes: "a" });
    const b = await addCopy(t, w, w.bob);
    const rows = await copiesOf(t, "ann", [b, a]);
    expect(rows.map((row) => row._id)).toEqual([b, a]);
    expect(rows[0].household?.owner.memberId).toBe(w.bob);
    expect(rows[1].notes).toBe("a");
    expect(rows[1]).toHaveProperty("coverUrl");
  });

  test("a copy that is neither yours nor a housemate's is not returned", async () => {
    const eves = await addCopy(t, w, w.eve, { notes: "private note" });
    const mine = await addCopy(t, w, w.ann);
    const rows = await copiesOf(t, "ann", [eves, mine]);
    expect(rows.map((row) => row._id)).toEqual([mine]);
  });

  test("a deleted copy is left out and repeats count once", async () => {
    const gone = await addCopy(t, w, w.ann);
    const kept = await addCopy(t, w, w.ann);
    await t.run((ctx) => ctx.db.delete(gone));
    const rows = await copiesOf(t, "ann", [gone, kept, kept]);
    expect(rows.map((row) => row._id)).toEqual([kept]);
  });

  test("reads at most LIBRARY_WINDOW_MAX ids", async () => {
    const id = await addCopy(t, w, w.ann);
    const rows = await copiesOf(
      t,
      "ann",
      Array.from({ length: LIBRARY_WINDOW_MAX + 5 }, () => id),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("library.myOwnedDefinitionIds", () => {
  const idsOf = (who: string) =>
    t
      .withIdentity({ subject: `clerk_${who}` })
      .query(api.library.listMyOwnedDefinitionIds.listMyOwnedDefinitionIds, {});

  test("requires a signed-in member", async () => {
    await expect(
      t.query(
        api.library.listMyOwnedDefinitionIds.listMyOwnedDefinitionIds,
        {},
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("the definitions of the caller's own copies, once each; a housemate's stay out", async () => {
    await addCopy(t, w, w.ann, { puzzleDefinitionId: "def-a" });
    await addCopy(t, w, w.ann, { puzzleDefinitionId: "def-a" });
    await addCopy(t, w, w.ann, { puzzleDefinitionId: "def-b" });
    await addCopy(t, w, w.ann);
    await addCopy(t, w, w.bob, { puzzleDefinitionId: "def-c" });
    expect((await idsOf("ann")).sort()).toEqual(["def-a", "def-b"]);
  });
});

describe("the bounded whole-library reads", () => {
  test("a non-owner reads only the newest copies of another member's library", async () => {
    const ids = await t.run(async (ctx) => {
      const out: Id<"ownedPuzzles">[] = [];
      for (let i = 0; i < 205; i++) {
        out.push(
          await ctx.db.insert("ownedPuzzles", {
            puzzleId: w.puzzleId,
            ownerId: w.eve,
            condition: "good",
            availability: swap,
            createdAt: i,
            updatedAt: i,
          }),
        );
      }
      return out;
    });
    const rows = await t
      .withIdentity({ subject: "clerk_ann" })
      .query(api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner, {
        ownerId: w.eve,
      });
    expect(rows).toHaveLength(200);
    expect(rows[0]._id).toBe(ids[204]);
  });

  test("the owner's picker read and the household's stay bounded", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i <= LIBRARY_INDEX_CAP; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId: w.puzzleId,
          ownerId: w.bob,
          condition: "good",
          availability: closed,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    const own = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner, {
        ownerId: w.bob,
        includeUnavailable: true,
      });
    expect(own).toHaveLength(LIBRARY_INDEX_CAP);
    const mates = await t
      .withIdentity({ subject: "clerk_ann" })
      .query(api.household.listHouseholdCopies.listHouseholdCopies, {});
    expect(mates).toHaveLength(LIBRARY_INDEX_CAP);
  });
});
