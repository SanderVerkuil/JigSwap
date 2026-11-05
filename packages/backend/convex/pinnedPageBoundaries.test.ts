import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// The paged lists read through convex-helpers' stream() end a page where its numItems run out, so a
// page's end moves when the data changes. These tests read them the way the web does
// (convex-helpers/react's usePaginatedQuery, or by hand on the public page): once a next page exists,
// the page before it is pinned to where that next page starts. Then a change between reads can't lose
// or repeat a row at the boundary (PERF-B13).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
interface Page<Row> {
  page: Row[];
  continueCursor: string;
  isDone: boolean;
}
type PaginationOpts = {
  numItems: number;
  cursor: string | null;
  endCursor?: string;
};

/**
 * Reads the first `pages` pages of a list as the hook holds them: each page but the last pinned to
 * where the next one starts. `reread` runs them again, as a subscription does after a write.
 */
const loadPinned = async <Row>(
  read: (opts: PaginationOpts) => Promise<Page<Row>>,
  numItems: number,
  pages: number,
) => {
  const held: PaginationOpts[] = [{ numItems, cursor: null }];
  let last = await read(held[0]);
  for (let i = 1; i < pages; i++) {
    const boundary = last.continueCursor;
    held[i - 1] = { ...held[i - 1], endCursor: boundary };
    held.push({ numItems, cursor: boundary });
    last = await read(held[i]);
  }
  return {
    reread: async () => {
      const rows: Row[] = [];
      for (const opts of held) rows.push(...(await read(opts)).page);
      return rows;
    },
  };
};

const addUsers = (t: T, names: string[]) =>
  t.run(async (ctx) => {
    const ids: Id<"users">[] = [];
    for (const name of names) {
      ids.push(
        await ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    }
    return ids;
  });

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

let t: T;

beforeEach(() => {
  t = convexTest(schema, modules);
});

describe("social.myNetwork", () => {
  let ann: Id<"users">;
  let others: Id<"users">[];
  const follow = (followeeId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("follows", {
        followerId: ann,
        followeeId,
        createdAt: 1,
      }),
    );
  const network = () =>
    loadPinned(
      (paginationOpts) =>
        as(t, "ann").query(api.social.listMyNetwork.listMyNetwork, {
          paginationOpts,
        }),
      2,
      2,
    );
  const ids = (rows: { memberId: string }[]) => rows.map((r) => r.memberId);

  beforeEach(async () => {
    const names = ["b0", "b1", "b2", "b3", "b4", "b5"];
    [ann, ...others] = await addUsers(t, ["ann", ...names]);
    // Newest edge first: b4 b3 | b2 b1 | b0, with b5 left to follow later.
    for (const id of others.slice(0, 5)) await follow(id);
  });

  test("a new follow joins the top without losing the member at the boundary", async () => {
    const { reread } = await network();
    const before = [others[4], others[3], others[2], others[1]];
    expect(ids(await reread())).toEqual(before);
    await follow(others[5]);
    expect(ids(await reread())).toEqual([others[5], ...before]);
  });

  test("an unfollow doesn't repeat the member at the boundary", async () => {
    const { reread } = await network();
    await t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", ann))
        .filter((q) => q.eq(q.field("followeeId"), others[4]))
        .unique();
      if (edge) await ctx.db.delete(edge._id);
    });
    expect(ids(await reread())).toEqual([others[3], others[2], others[1]]);
  });

  // Why the web must pin: read the same pages without it and the boundary member vanishes.
  test("without the pin the same change does lose that member", async () => {
    const opts = { numItems: 2, cursor: null };
    const read = (paginationOpts: PaginationOpts) =>
      as(t, "ann").query(api.social.listMyNetwork.listMyNetwork, {
        paginationOpts,
      });
    const first = await read(opts);
    await follow(others[5]);
    const rows = [
      ...(await read(opts)).page,
      ...(await read({ ...opts, cursor: first.continueCursor })).page,
    ];
    expect(ids(rows)).not.toContain(others[3]);
  });
});

describe("exchange.myHistory", () => {
  let ann: Id<"users">;
  let bob: Id<"users">;
  let puzzleId: Id<"puzzles">;
  const exchange = (
    status: Doc<"exchanges">["status"],
    updatedAt: number,
    aggregateId: string,
  ) =>
    t.run(async (ctx) => {
      const copy = (ownerId: Id<"users">) =>
        ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId,
          condition: "good",
          availability: { forTrade: true, forSale: false, forLend: false },
          createdAt: 1,
          updatedAt: 1,
        });
      return ctx.db.insert("exchanges", {
        aggregateId,
        initiatorId: ann,
        recipientId: bob,
        requestedPuzzleId: await copy(bob),
        offeredPuzzleId: await copy(ann),
        type: "trade",
        status,
        createdAt: 1,
        updatedAt,
      });
    });

  beforeEach(async () => {
    [ann, bob] = await addUsers(t, ["ann", "bob"]);
    puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Harbour Lights",
        pieceCount: 1000,
        status: "approved",
        submittedBy: ann,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
  });

  test("an exchange settling doesn't lose a finished row with two pages loaded", async () => {
    for (let i = 1; i <= 5; i++) await exchange("completed", i * 10, `e${i}`);
    const live = await exchange("proposed", 60, "live");
    const { reread } = await loadPinned(
      (paginationOpts) =>
        as(t, "ann").query(
          api.exchange.listMyExchangeHistory.listMyExchangeHistory,
          { paginationOpts },
        ),
      2,
      2,
    );
    const finished = (rows: { aggregateId?: string }[]) =>
      rows.map((row) => row.aggregateId);
    expect(finished(await reread())).toEqual(["e5", "e4", "e3", "e2"]);

    await t.run((ctx) =>
      ctx.db.patch(live, { status: "completed", updatedAt: 70 }),
    );
    expect(finished(await reread())).toEqual(["live", "e5", "e4", "e3", "e2"]);
  });
});

type ReviewRead = (args: {
  puzzleId: Id<"puzzles">;
  paginationOpts: PaginationOpts;
}) => Promise<Page<{ text: string | null }>>;

describe.each<[string, ReviewRead]>([
  [
    "social.listPuzzleReviews",
    (args) =>
      as(t, "viewer").query(
        api.social.listPuzzleReviews.listPuzzleReviewsPage,
        args,
      ),
  ],
  [
    "social.listPublicPuzzleReviews",
    (args) =>
      t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviewsPage,
        args,
      ),
  ],
])("%s", (_, read) => {
  let puzzleId: Id<"puzzles">;
  let users: Id<"users">[];
  const review = (userId: Id<"users">, updatedAt: number) =>
    t.run((ctx) =>
      ctx.db.insert("puzzleReviews", {
        puzzleId,
        userId,
        rating: 4,
        text: `at ${updatedAt}`,
        createdAt: 1,
        updatedAt,
      }),
    );
  const load = () =>
    loadPinned((paginationOpts) => read({ puzzleId, paginationOpts }), 2, 2);
  const texts = (rows: { text: string | null }[]) => rows.map((r) => r.text);

  beforeEach(async () => {
    users = await addUsers(t, ["viewer", "r1", "r2", "r3", "r4", "r5", "r6"]);
    puzzleId = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Harbour Lights",
        pieceCount: 1000,
        status: "approved",
        submittedBy: users[0],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    for (let i = 1; i <= 5; i++) await review(users[i], i * 10);
  });

  test("a new review joins the top without losing the boundary row", async () => {
    const { reread } = await load();
    expect(texts(await reread())).toEqual(["at 50", "at 40", "at 30", "at 20"]);
    await review(users[6], 60);
    expect(texts(await reread())).toEqual([
      "at 60",
      "at 50",
      "at 40",
      "at 30",
      "at 20",
    ]);
  });

  test("a review moved up by an edit is listed once, with no hole left behind", async () => {
    const { reread } = await load();
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("puzzleReviews")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
        .filter((q) => q.eq(q.field("userId"), users[3]))
        .unique();
      if (row) await ctx.db.patch(row._id, { text: "edited", updatedAt: 60 });
    });
    // The last page isn't pinned yet: with room again, it reaches one row further.
    expect(texts(await reread())).toEqual([
      "edited",
      "at 50",
      "at 40",
      "at 20",
      "at 10",
    ]);
  });
});
