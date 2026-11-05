import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { COPY_SCAN_LIMIT } from "./search/globalSearch";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const insertUser = (
  t: TestConvex<typeof schema>,
  clerkId: string,
  name: string,
  username: string,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name,
      username,
      searchableName: `${name} ${username}`.toLowerCase(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const setVisibility = (
  t: TestConvex<typeof schema>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      displayName: "x",
      visibility,
      updatedAt: Date.now(),
    });
  });

const follow = (
  t: TestConvex<typeof schema>,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
  });

const asUser = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });

describe("search.global people results", () => {
  test("finds a public member via the name/username search index", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    await insertUser(t, "clerk_target", "Patricia Public", "patricia");

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "patricia" },
    );
    expect(res.people.map((p) => p.name)).toContain("Patricia Public");
  });

  test("hides a private-profile member from a non-connected searcher", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "priv" },
    );
    expect(res.people).toHaveLength(0);
  });

  test("reveals a private member to a mutual follower", async () => {
    const t = convexTest(schema, modules);
    const searcher = await insertUser(
      t,
      "clerk_searcher",
      "Sam Searcher",
      "sam",
    );
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");
    await follow(t, searcher, target);
    await follow(t, target, searcher);

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "priv" },
    );
    expect(res.people.map((p) => p.name)).toContain("Priv Person");
  });

  test("excludes the searcher themself from people results", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_self", "Self Searcher", "self");

    const res = await asUser(t, "clerk_self").query(
      api.search.globalSearch.global,
      { term: "self" },
    );
    expect(res.people).toHaveLength(0);
  });
});

// SEC-49: each group is clamped server-side, whatever `limit` the client sends.
describe("search.global limit", () => {
  test("an oversized limit returns at most 10 puzzles", async () => {
    const t = convexTest(schema, modules);
    const searcher = await insertUser(
      t,
      "clerk_searcher",
      "Sam Searcher",
      "sam",
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("puzzles", {
          title: `Vista ${i}`,
          pieceCount: 1000,
          searchableText: `vista ${i}`,
          status: "approved",
          submittedBy: searcher,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "vista", limit: 1e6 },
    );
    expect(res.puzzles).toHaveLength(10);
  });
});

// The ⌘K "In your library" group: the searcher's OWN copies only (any visibility), matched on the
// copy's cached title/brand, linking to the owner's copy page. Never another member's copy.
const insertPuzzle = (
  t: TestConvex<typeof schema>,
  submittedBy: Id<"users">,
  title: string,
  brand?: string,
) =>
  t.run((ctx) =>
    ctx.db.insert("puzzles", {
      title,
      brand,
      pieceCount: 1000,
      status: "approved",
      submittedBy,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

const insertCopy = (
  t: TestConvex<typeof schema>,
  ownerId: Id<"users">,
  puzzleId: Id<"puzzles">,
  over: {
    title?: string;
    brand?: string;
    visibility?: "private" | "visible";
    forTrade?: boolean;
  } = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability: {
        forTrade: over.forTrade ?? false,
        forSale: false,
        forLend: false,
      },
      visibility: over.visibility,
      ...(over.title === undefined
        ? {}
        : {
            snapshot: {
              title: over.title,
              brand: over.brand,
              pieceCount: 1000,
            },
          }),
      createdAt: 1,
      updatedAt: 1,
    }),
  );

describe("search.global library copies", () => {
  test("finds the searcher's own private copy by title and links to its page", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Lam Gelegd", "Jumbo");
    const copyId = await insertCopy(t, me, puzzle, {
      title: "Lam Gelegd",
      brand: "Jumbo",
      visibility: "private",
    });

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "gelegd" },
    );
    expect(res.copies).toEqual([
      {
        id: copyId,
        title: "Lam Gelegd",
        brand: "Jumbo",
        image: null,
        href: `/my-puzzles/${copyId}`,
      },
    ]);
  });

  test("matches the brand too", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Alpen", "Ravensburger");
    await insertCopy(t, me, puzzle, { title: "Alpen", brand: "Ravensburger" });

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "ravens" },
    );
    expect(res.copies.map((hit) => hit.title)).toEqual(["Alpen"]);
  });

  test("falls back to the catalogue title for a copy without a snapshot", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Oude Molen");
    await insertCopy(t, me, puzzle);

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "molen" },
    );
    expect(res.copies.map((hit) => hit.title)).toEqual(["Oude Molen"]);
  });

  test("never returns another member's copy, however visible", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_me", "Me Myself", "me");
    const other = await insertUser(t, "clerk_other", "Olga Other", "olga");
    const puzzle = await insertPuzzle(t, other, "Lam Gelegd");
    await insertCopy(t, other, puzzle, {
      title: "Lam Gelegd",
      visibility: "visible",
      forTrade: true,
    });

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "gelegd" },
    );
    expect(res.copies).toEqual([]);
  });

  test("returns at most `limit` copies", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Kasteel");
    for (let i = 0; i < 7; i++) {
      await insertCopy(t, me, puzzle, { title: `Kasteel ${i}` });
    }

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "kasteel" },
    );
    expect(res.copies).toHaveLength(5);
    const three = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "kasteel", limit: 3 },
    );
    expect(three.copies).toHaveLength(3);
  });

  test("looks only through the newest copies, a bounded read", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Hooiberg");
    // The oldest copy is the only match; COPY_SCAN_LIMIT newer copies sit in front of it.
    await insertCopy(t, me, puzzle, { title: "Speld" });
    await t.run(async (ctx) => {
      for (let i = 0; i < COPY_SCAN_LIMIT; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId: puzzle,
          ownerId: me,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          snapshot: { title: `Hooiberg ${i}`, pieceCount: 1000 },
          createdAt: 2,
          updatedAt: 2,
        });
      }
    });

    const res = await asUser(t, "clerk_me").query(
      api.search.globalSearch.global,
      { term: "speld" },
    );
    expect(res.copies).toEqual([]);
  });

  test("an unauthenticated caller gets no copies", async () => {
    const t = convexTest(schema, modules);
    const me = await insertUser(t, "clerk_me", "Me Myself", "me");
    const puzzle = await insertPuzzle(t, me, "Lam Gelegd");
    await insertCopy(t, me, puzzle, { title: "Lam Gelegd" });

    const res = await t.query(api.search.globalSearch.global, {
      term: "gelegd",
    });
    expect(res.copies).toEqual([]);
  });
});
