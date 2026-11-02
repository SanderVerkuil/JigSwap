import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The review lists page instead of reading every review of a definition (PERF-B13): most recently
// updated first, in order across pages, with the block rules applied while a page fills.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const reviewers = (count: number) =>
  Array.from({ length: count }, (_, i) => `r${i}`);

interface World {
  puzzleId: Id<"puzzles">;
  pendingId: Id<"puzzles">;
  users: Record<string, Id<"users">>;
}

const seed = (t: T, names: string[]): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const users: Record<string, Id<"users">> = {};
    for (const name of ["viewer", ...names]) {
      users[name] = await ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    const puzzle = (status: "approved" | "pending") =>
      ctx.db.insert("puzzles", {
        title: "Harbour Lights",
        pieceCount: 1000,
        status,
        submittedBy: users.viewer,
        createdAt: now,
        updatedAt: now,
      });
    const puzzleId = await puzzle("approved");
    const pendingId = await puzzle("pending");
    // Inserted oldest update first, except that the first reviewer updated last.
    for (const [i, name] of names.entries()) {
      await ctx.db.insert("puzzleReviews", {
        userId: users[name],
        puzzleId,
        rating: 4,
        text: name,
        createdAt: now,
        updatedAt: i === 0 ? now + 100 : now + i,
      });
    }
    return { puzzleId, pendingId, users };
  });

const memberPage = (
  t: T,
  puzzleId: Id<"puzzles">,
  numItems: number,
  cursor: string | null = null,
) =>
  t
    .withIdentity({ subject: "clerk_viewer" })
    .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
      puzzleId,
      paginationOpts: { numItems, cursor },
    });

const publicPage = (
  t: T,
  puzzleId: Id<"puzzles">,
  numItems: number,
  cursor: string | null = null,
) =>
  t.query(api.social.listPublicPuzzleReviews.listPublicPuzzleReviewsPage, {
    puzzleId,
    paginationOpts: { numItems, cursor },
  });

const walk = async <Row>(
  fetch: (cursor: string | null) => Promise<{
    page: Row[];
    isDone: boolean;
    continueCursor: string;
  }>,
) => {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result = await fetch(cursor);
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
};

let t: T;

beforeEach(() => {
  t = convexTest(schema, modules);
});

describe.each([
  ["social.listPuzzleReviews", memberPage],
  ["social.listPublicPuzzleReviews", publicPage],
] as const)("%s", (_, page) => {
  test("most recently updated first, across pages, without repeats or holes", async () => {
    const names = reviewers(5);
    const w = await seed(t, names);
    const rows = await walk<{ text: string | null }>((cursor) =>
      page(t, w.puzzleId, 2, cursor),
    );
    expect(rows.map((row) => row.text)).toEqual(["r0", "r4", "r3", "r2", "r1"]);
  });

  test("clamps the page size", async () => {
    const w = await seed(t, reviewers(55));
    expect((await page(t, w.puzzleId, 1000)).page.length).toBeLessThanOrEqual(
      50,
    );
    expect((await page(t, w.puzzleId, 0)).page).toHaveLength(1);
  });

  test("an author who blocked the viewer drops out and the page stays full", async () => {
    const w = await seed(t, reviewers(3));
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: w.users.r0,
        blockedId: w.users.viewer,
        createdAt: Date.now(),
      }),
    );
    const { page: rows } = await memberPage(t, w.puzzleId, 1);
    expect(rows.map((row) => row.text)).toEqual(["r2"]);
  });
});

describe("a definition the caller may not see", () => {
  test("is an empty, finished page on the public list", async () => {
    const w = await seed(t, []);
    expect(await publicPage(t, w.pendingId, 10)).toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
  });

  test("is an empty, finished page for a member who may not see it", async () => {
    const w = await seed(t, ["other"]);
    await expect(
      t
        .withIdentity({ subject: "clerk_other" })
        .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
          puzzleId: w.pendingId,
          paginationOpts: { numItems: 10, cursor: null },
        }),
    ).resolves.toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});

// A tab or an SSR build from before paging still asks with just the puzzle. It must keep reading
// reviews, not fail validation and say "No reviews yet", and it goes through the same gates.
describe("web builds from before the lists paged", () => {
  const memberRead = (who: string, puzzleId: Id<"puzzles">) =>
    t
      .withIdentity({ subject: `clerk_${who}` })
      .query(api.social.listPuzzleReviews.listPuzzleReviews, { puzzleId });
  const publicRead = (puzzleId: Id<"puzzles">) =>
    t.query(api.social.listPublicPuzzleReviews.listPublicPuzzleReviews, {
      puzzleId,
    });

  test("read an array of the newest reviews, most recently updated first", async () => {
    const w = await seed(t, reviewers(3));
    const expected = ["r0", "r2", "r1"];
    expect(
      (await memberRead("viewer", w.puzzleId)).map((row) => row.text),
    ).toEqual(expected);
    expect((await publicRead(w.puzzleId)).map((row) => row.text)).toEqual(
      expected,
    );
  });

  test("get no more than one page", async () => {
    const w = await seed(t, reviewers(55));
    expect(await publicRead(w.puzzleId)).toHaveLength(50);
    expect(await memberRead("viewer", w.puzzleId)).toHaveLength(50);
  });

  test("keep the gates: a hidden definition is empty and a block still drops the author", async () => {
    const w = await seed(t, ["r0", "other"]);
    expect(await publicRead(w.pendingId)).toEqual([]);
    expect(await memberRead("other", w.pendingId)).toEqual([]);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: w.users.r0,
        blockedId: w.users.viewer,
        createdAt: Date.now(),
      }),
    );
    expect(
      (await memberRead("viewer", w.puzzleId)).map((row) => row.text),
    ).toEqual(["other"]);
  });
});
