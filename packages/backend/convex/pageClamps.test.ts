import { convexTest, type TestConvex } from "convex-test";
import type { PaginationOptions } from "convex/server";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PUBLIC_CATALOG_MAX_PAGE } from "./catalog/browsePublicCatalog";
import {
  clampPaginationOpts,
  clampUnpinnedPaginationOpts,
  keepPinnedEnd,
  PINNED_PAGE_READ_FACTOR,
} from "./lib/pageSize";
import { MAX_NOTIFICATION_PAGE_SIZE } from "./notifications/listMyNotificationViews";
import schema from "./schema";
import { MAX_REVIEW_PAGE_SIZE } from "./social/listPuzzleReviews";

// A client's numItems is a request, and so is everything else in its pagination options: an
// endCursor overrides numItems, so one call could read every row up to a far cursor, anonymously on
// the public reads. These tests walk real cursors and then ask for one row up to a far one.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Opts = { numItems: number; cursor: string | null; endCursor?: string };

const memberRow = (name: string) => ({
  clerkId: `clerk_${name}`,
  email: `${name}@example.com`,
  name,
  isActive: true,
  createdAt: 1,
  updatedAt: 1,
});

const addDefinitions = (
  t: T,
  submittedBy: Id<"users">,
  count: number,
  difficultyOf?: (i: number) => "easy" | "expert",
) =>
  t.run(async (ctx) => {
    const ids: Id<"puzzles">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await ctx.db.insert("puzzles", {
          title: `Puzzle ${i}`,
          pieceCount: 1000,
          ...(difficultyOf && { difficulty: difficultyOf(i) }),
          status: "approved",
          submittedBy,
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    }
    return ids;
  });

// Reads `pages` full pages: a cursor any client can get.
const farCursorOf = async (
  read: (opts: Opts) => Promise<{ continueCursor: string }>,
  numItems: number,
  pages: number,
): Promise<string> => {
  let cursor: string | null = null;
  let continueCursor = "";
  for (let i = 0; i < pages; i++) {
    ({ continueCursor } = await read({ numItems, cursor }));
    cursor = continueCursor;
  }
  return continueCursor;
};

let t: T;
let me: Id<"users">;
const asMe = () => t.withIdentity({ subject: "clerk_me" });

beforeEach(async () => {
  t = convexTest(schema, modules);
  me = await t.run((ctx) => ctx.db.insert("users", memberRow("me")));
});

describe("clampPaginationOpts", () => {
  test("a page without an endCursor stays bounded by numItems alone", () => {
    expect(clampPaginationOpts({ numItems: 1e9, cursor: "a" }, 50)).toEqual({
      numItems: 50,
      cursor: "a",
    });
  });

  test("a pinned page reads at most a few pages' worth, whatever it asks for", () => {
    const bound = 50 * PINNED_PAGE_READ_FACTOR;
    const pinned: PaginationOptions = {
      numItems: 1,
      cursor: null,
      endCursor: "z",
    };
    expect(clampPaginationOpts(pinned, 50).maximumRowsRead).toBe(bound);
    for (const maximumRowsRead of [1e9, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        clampPaginationOpts({ ...pinned, maximumRowsRead }, 50).maximumRowsRead,
      ).toBe(bound);
    }
    // Asking for less is the client's own business.
    expect(
      clampPaginationOpts({ ...pinned, maximumRowsRead: 10 }, 50)
        .maximumRowsRead,
    ).toBe(10);
  });

  test("the unpinned form drops the endCursor and clamps numItems", () => {
    expect(
      clampUnpinnedPaginationOpts(
        { numItems: 1e9, cursor: "a", endCursor: "z" },
        50,
      ),
    ).toEqual({ numItems: 50, cursor: "a", endCursor: undefined });
  });
});

describe("keepPinnedEnd", () => {
  const cut = {
    page: [],
    isDone: false,
    continueCursor: "cut",
    splitCursor: "mid",
    pageStatus: "SplitRequired" as const,
  };

  test("a pinned page cut by its bound still ends at its pin", () => {
    expect(keepPinnedEnd(cut, { endCursor: "pin" }).continueCursor).toBe("pin");
  });

  test("anything else is left as read", () => {
    expect(keepPinnedEnd(cut, {})).toEqual(cut);
    const whole = { page: [], isDone: false, continueCursor: "pin" };
    expect(keepPinnedEnd(whole, { endCursor: "pin" })).toEqual(whole);
  });
});

describe("a far endCursor can't read past a page's bound", () => {
  test("the anonymous catalog drops it: no client pins its pages", async () => {
    await addDefinitions(t, me, 3 * PUBLIC_CATALOG_MAX_PAGE);
    const browse = api.catalog.browsePublicCatalog.browsePublicCatalog;
    const far = await farCursorOf(
      (paginationOpts) => t.query(browse, { paginationOpts }),
      PUBLIC_CATALOG_MAX_PAGE,
      2,
    );

    const { page } = await t.query(browse, {
      paginationOpts: { numItems: 1, cursor: null, endCursor: far },
    });
    expect(page).toHaveLength(1);
  });

  test("the sitemap feed and the anonymous list drop it too", async () => {
    await addDefinitions(t, me, 12);
    for (const list of [
      api.catalog.listSitemapEntries.listSitemapEntries,
      api.catalog.listAllPuzzles.listAllPuzzles,
    ]) {
      const far = await farCursorOf(
        (paginationOpts) => t.query(list, { paginationOpts }),
        10,
        1,
      );
      const { page } = await t.query(list, {
        paginationOpts: { numItems: 1, cursor: null, endCursor: far },
      });
      expect(page).toHaveLength(1);
    }
  });

  test("the anonymous reviews page keeps its pin, within the bound", async () => {
    const [puzzleId] = await addDefinitions(t, me, 1);
    const count = (PINNED_PAGE_READ_FACTOR + 2) * MAX_REVIEW_PAGE_SIZE;
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        const userId = await ctx.db.insert("users", memberRow(`author${i}`));
        await ctx.db.insert("puzzleReviews", {
          puzzleId,
          userId,
          rating: 5,
          createdAt: i + 1,
          updatedAt: i + 1,
        });
      }
    });
    const reviews =
      api.social.listPublicPuzzleReviews.listPublicPuzzleReviewsPage;
    const far = await farCursorOf(
      (paginationOpts) => t.query(reviews, { puzzleId, paginationOpts }),
      MAX_REVIEW_PAGE_SIZE,
      PINNED_PAGE_READ_FACTOR + 1,
    );

    const capped = await t.query(reviews, {
      puzzleId,
      paginationOpts: { numItems: 1, cursor: null, endCursor: far },
    });
    expect(capped.page).toHaveLength(
      PINNED_PAGE_READ_FACTOR * MAX_REVIEW_PAGE_SIZE,
    );
    // Said as a split, which is what every paging client acts on.
    expect(capped.pageStatus).toBe("SplitRequired");
    expect(capped.splitCursor).toBeTruthy();

    // A pin the client honestly holds still gets exactly its page.
    const first = await t.query(reviews, {
      puzzleId,
      paginationOpts: { numItems: MAX_REVIEW_PAGE_SIZE, cursor: null },
    });
    const pinned = await t.query(reviews, {
      puzzleId,
      paginationOpts: {
        numItems: MAX_REVIEW_PAGE_SIZE,
        cursor: null,
        endCursor: first.continueCursor,
      },
    });
    expect(pinned.page).toEqual(first.page);
    expect(pinned.pageStatus).toBeFalsy();
  });

  test("a client can't raise the bound with its own maximumRowsRead", async () => {
    await addDefinitions(t, me, (PINNED_PAGE_READ_FACTOR + 2) * 50);
    const search = api.catalog.searchCatalog.searchCatalog;
    const far = await farCursorOf(
      (paginationOpts) => asMe().query(search, { paginationOpts }),
      50,
      PINNED_PAGE_READ_FACTOR + 1,
    );

    const { page } = await asMe().query(search, {
      paginationOpts: {
        numItems: 1,
        cursor: null,
        endCursor: far,
        maximumRowsRead: 1e9,
      },
    });
    expect(page).toHaveLength(PINNED_PAGE_READ_FACTOR * 50);
  });
});

// A filtering read can honestly span more rows than the bound, and the paging hooks split a page on
// what the response says (usePaginatedQuery: first half up to splitCursor, second half up to
// continueCursor): no row may fall out of that.
describe("splitting a pinned page that hit the bound keeps every row", () => {
  test("the member catalogue search, split the way the hooks split it", async () => {
    // One definition in ten matches, so 50 matches span about 500 rows; the bound is 200.
    await addDefinitions(t, me, 600, (i) => (i % 10 === 0 ? "expert" : "easy"));
    const search = (paginationOpts: Opts) =>
      asMe().query(api.catalog.searchCatalog.searchCatalog, {
        difficulty: "expert",
        paginationOpts,
      });
    const first = await search({ numItems: 50, cursor: null });
    expect(first.page).toHaveLength(50);

    const readSplit = async (
      cursor: string | null,
      endCursor: string,
    ): Promise<string[]> => {
      const result = await search({ numItems: 50, cursor, endCursor });
      if (result.pageStatus !== "SplitRequired") {
        return result.page.map((row) => row._id);
      }
      const middle = result.splitCursor as string;
      return [
        ...(await readSplit(cursor, middle)),
        ...(await readSplit(middle, result.continueCursor)),
      ];
    };
    expect(await readSplit(null, first.continueCursor)).toEqual(
      first.page.map((row) => row._id),
    );
  });
});

describe("a non-finite size asks for the default", () => {
  test("getCommunityAvatars and getPlankPuzzles keep their caps", async () => {
    await addDefinitions(t, me, 20);
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        const memberId = await ctx.db.insert("users", memberRow(`public${i}`));
        await ctx.db.insert("profiles", {
          aggregateId: `profile_${i}`,
          memberId,
          visibility: "public",
          updatedAt: 1,
        });
      }
    });

    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        await t.query(api.insights.getCommunityAvatars.getCommunityAvatars, {
          limit,
          seed: 1,
        }),
      ).toHaveLength(8);
      expect(
        await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
          limit,
          seed: 1,
        }),
      ).toHaveLength(12);
    }
  });

  test("the notification feed reads a full page", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_NOTIFICATION_PAGE_SIZE + 5; i++) {
        await ctx.db.insert("notifications", {
          userId: me,
          type: "puzzle_approved",
          channel: "inApp",
          isRead: false,
          createdAt: i + 1,
        });
      }
    });
    const { page } = await asMe().query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: Number.NaN, cursor: null } },
    );
    expect(page).toHaveLength(MAX_NOTIFICATION_PAGE_SIZE);
  });

  test("a thread's messages read a full page", async () => {
    const threadId = "thread_1";
    await t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: threadId,
        subjectKind: "dm",
        participants: [me],
        participantsKey: me,
        createdAt: 0,
      });
      for (let i = 1; i <= 105; i++) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: threadId,
          messageId: `m${i}`,
          authorId: me,
          kind: "text",
          body: `m${i}`,
          sentAt: i,
        });
      }
    });
    const { page } = await asMe().query(
      api.conversation.listThreadMessages.listThreadMessages,
      { threadId, paginationOpts: { numItems: Number.NaN, cursor: null } },
    );
    expect(page).toHaveLength(100);
  });
});
