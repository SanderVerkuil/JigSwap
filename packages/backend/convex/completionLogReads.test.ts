import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { rangesLeftAfterUrls } from "../test-fixtures/readBudget";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  COMPLETION_INDEX_CAP,
  COMPLETION_ROWS_MAX,
} from "./solving/completionLogLimits";

// The completion log reads a lean row per solve (for its stats, order and year headings) and joins
// only the rows on screen (PERF-B13).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

interface World {
  ann: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
  copyId: Id<"ownedPuzzles">;
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
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: ann,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { ann, bob, puzzleId, copyId };
  });

const addCompletion = (
  t: T,
  userId: Id<"users">,
  extra: Partial<Doc<"completions">> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("completions", {
      userId,
      startDate: 10,
      endDate: 20,
      photos: [],
      isCompleted: true,
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    }),
  );

const indexOf = (t: T, who: string) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.solving.listMyCompletionIndex.listMyCompletionIndex, {});

const rowsOf = (t: T, who: string, completionIds: Id<"completions">[]) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.solving.getMyCompletionsByIds.getMyCompletionsByIds, {
      completionIds,
    });

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("solving.myCompletionIndex", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.solving.listMyCompletionIndex.listMyCompletionIndex, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("one lean row per own solve, with what the log orders and counts by", async () => {
    const done = await addCompletion(t, w.ann, {
      notes: "private note",
      endDate: 99,
      datePrecision: "year",
      copySnapshot: {
        copyId: "c",
        ownerId: w.ann,
        wasBorrowed: false,
        condition: "good",
        title: "Snapshot",
        pieceCount: 750,
      },
    });
    const open = await addCompletion(t, w.ann, {
      isCompleted: false,
      endDate: undefined,
    });
    await addCompletion(t, w.bob);

    const rows = await indexOf(t, "ann");
    expect(rows.map((row) => row._id).sort()).toEqual([done, open].sort());
    expect(rows.find((row) => row._id === done)).toEqual({
      _id: done,
      isCompleted: true,
      startDate: 10,
      endDate: 99,
      datePrecision: "year",
      pieceCount: 750,
    });
    expect(rows.find((row) => row._id === open)).toEqual({
      _id: open,
      isCompleted: false,
      startDate: 10,
    });
  });

  test("a legacy row without a snapshot takes its piece count from the puzzle", async () => {
    await addCompletion(t, w.ann, { puzzleId: w.puzzleId });
    await addCompletion(t, w.ann, { ownedPuzzleId: w.copyId });
    const rows = await indexOf(t, "ann");
    expect(rows.map((row) => row.pieceCount)).toEqual([1000, 1000]);
  });

  test("past the cap the newest solves stay", async () => {
    const ids = await t.run(async (ctx) => {
      const out: Id<"completions">[] = [];
      for (let i = 0; i <= COMPLETION_INDEX_CAP; i++) {
        out.push(
          await ctx.db.insert("completions", {
            userId: w.ann,
            startDate: 1,
            photos: [],
            isCompleted: true,
            createdAt: 1,
            updatedAt: 1,
          }),
        );
      }
      return out;
    });
    const rows = await indexOf(t, "ann");
    expect(rows).toHaveLength(COMPLETION_INDEX_CAP);
    expect(rows.map((row) => row._id)).toContain(ids[COMPLETION_INDEX_CAP]);
    expect(rows.map((row) => row._id)).not.toContain(ids[0]);
  });
});

describe("solving.myCompletionsByIds", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.solving.getMyCompletionsByIds.getMyCompletionsByIds, {
        completionIds: [],
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("the full rows asked for, in that order, with what a row renders", async () => {
    const a = await addCompletion(t, w.ann, {
      ownedPuzzleId: w.copyId,
      puzzleId: w.puzzleId,
      notes: "a note",
    });
    const b = await addCompletion(t, w.ann);
    const rows = await rowsOf(t, "ann", [b, a]);
    expect(rows.map((row) => row._id)).toEqual([b, a]);
    expect(rows[1].notes).toBe("a note");
    expect(rows[1].libraryInfo).toEqual({
      title: "Harbour Lights",
      pieceCount: 1000,
    });
    expect(rows[1].link).toEqual({ kind: "myCopy", id: w.copyId });
    expect(rows[1]).toHaveProperty("photoItems");
    expect(rows[1]).not.toHaveProperty("photos");
    expect(rows[0].libraryInfo).toBeUndefined();
  });

  test("another member's solve is not returned, nor a deleted one", async () => {
    const theirs = await addCompletion(t, w.bob, { notes: "bob's note" });
    const gone = await addCompletion(t, w.ann);
    const mine = await addCompletion(t, w.ann);
    await t.run((ctx) => ctx.db.delete(gone));
    const rows = await rowsOf(t, "ann", [theirs, gone, mine]);
    expect(rows.map((row) => row._id)).toEqual([mine]);
  });

  test("a copy that changed hands gives no library info", async () => {
    const copyOfBob = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: w.puzzleId,
        ownerId: w.bob,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const row = await addCompletion(t, w.ann, { ownedPuzzleId: copyOfBob });
    const [view] = await rowsOf(t, "ann", [row]);
    expect(view.libraryInfo).toBeUndefined();
  });

  // SEC-34: the log says of a copy what My Puzzles says of it (toCopyPuzzleView). The owner of a copy
  // of someone else's pending or rejected definition reads the copy's snapshot, never its live text.
  describe("a copy of a definition that isn't approved", () => {
    const logAgainst = async (
      status: Doc<"puzzles">["status"],
      submittedBy: Id<"users">,
    ) => {
      await t.run(async (ctx) => {
        await ctx.db.patch(w.puzzleId, {
          status,
          submittedBy,
          title: "Live title",
          pieceCount: 999,
        });
        await ctx.db.patch(w.copyId, {
          snapshot: { title: "Snapshot title", pieceCount: 500 },
        });
      });
      const id = await addCompletion(t, w.ann, { ownedPuzzleId: w.copyId });
      const [row] = await rowsOf(t, "ann", [id]);
      return row.libraryInfo;
    };

    test.each(["pending", "rejected"] as const)(
      "someone else's %s definition reads as the copy's snapshot",
      async (status) => {
        expect(await logAgainst(status, w.bob)).toEqual({
          title: "Snapshot title",
          pieceCount: 500,
        });
      },
    );

    test.each(["pending", "rejected"] as const)(
      "their own %s submission keeps its live title",
      async (status) => {
        expect(await logAgainst(status, w.ann)).toEqual({
          title: "Live title",
          pieceCount: 999,
        });
      },
    );

    test("a disabled definition, moderated once, keeps its live title", async () => {
      expect(await logAgainst("disabled", w.bob)).toEqual({
        title: "Live title",
        pieceCount: 999,
      });
    });

    test("agrees with what My Puzzles shows the same copy", async () => {
      const info = await logAgainst("rejected", w.bob);
      const library = await t
        .withIdentity({ subject: "clerk_ann" })
        .query(api.library.getMyLibraryCopies.getMyLibraryCopies, {
          copyIds: [w.copyId],
        });
      expect(library[0].puzzle?.title).toBe(info?.title);
      expect(library[0].puzzle?.pieceCount).toBe(info?.pieceCount);
    });
  });

  test("reads at most COMPLETION_ROWS_MAX ids, repeats counted once", async () => {
    const id = await addCompletion(t, w.ann);
    const rows = await rowsOf(
      t,
      "ann",
      Array.from({ length: COMPLETION_ROWS_MAX + 5 }, () => id),
    );
    expect(rows).toHaveLength(1);
  });
});

// The read's stated maximum has to hold under Convex's real limits (4,096 index ranges per function) for
// the most expensive rows a member can have, with its URLs counted as ranges too
// (test-fixtures/readBudget): each of 5 photos and the row's thumbnail resolve the image and its three
// renditions. The log itself asks for less: a page at a time.
describe("solving.myCompletionsByIds at its stated maximum", () => {
  const BASE = 1_700_000_000_000;

  // `count` solves, each of a distinct definition, with every photo allowed. `ownerOf` decides who
  // owns each solve's copy, which also decides how much the copy gate costs.
  const seedSolves = async (
    t: T,
    me: Id<"users">,
    count: number,
    ownerOf: (i: number) => Id<"users">,
  ) => {
    const ids: Id<"completions">[] = [];
    const image = await t.run(async (ctx) => {
      const store = () =>
        ctx.storage.store(new Blob(["x"], { type: "image/webp" }));
      const sourceId = await store();
      await ctx.db.insert("imageRenditions", {
        sourceId,
        width: 2000,
        height: 2000,
        small: { fileId: await store(), width: 480, height: 480 },
        medium: { fileId: await store(), width: 640, height: 640 },
        large: { fileId: await store(), width: 960, height: 960 },
        createdAt: BASE,
      });
      return sourceId;
    });
    for (let start = 0; start < count; start += 100) {
      const made = await t.run(async (ctx) => {
        const out: Id<"completions">[] = [];
        for (let i = start; i < Math.min(count, start + 100); i++) {
          const puzzleId = await ctx.db.insert("puzzles", {
            title: `p${i}`,
            pieceCount: 1000,
            status: "approved",
            image,
            submittedBy: me,
            createdAt: BASE,
            updatedAt: BASE,
          });
          const ownedPuzzleId = await ctx.db.insert("ownedPuzzles", {
            puzzleId,
            ownerId: ownerOf(i),
            aggregateId: `c${i}`,
            condition: "good",
            availability: { forTrade: false, forSale: false, forLend: false },
            createdAt: BASE,
            updatedAt: BASE,
          });
          const aggregateId = `solve-${i}`;
          const photos = [image, image, image, image, image];
          const completionId = await ctx.db.insert("completions", {
            aggregateId,
            userId: me,
            ownedPuzzleId,
            puzzleId,
            startDate: BASE,
            endDate: BASE + 1,
            isCompleted: true,
            photos,
            createdAt: BASE,
            updatedAt: BASE,
          });
          await ctx.db.insert("completionImages", {
            completionId: aggregateId,
            uploaderId: me,
            fileId: image,
            moderationStatus: "approved",
            createdAt: BASE,
            updatedAt: BASE,
          });
          out.push(completionId);
        }
        return out;
      });
      ids.push(...made);
    }
    return ids;
  };

  const URLS_PER_ROW = (5 + 1) * 4;
  const limited = () =>
    convexTest({
      schema,
      modules,
      transactionLimits: {
        databaseQueries: rangesLeftAfterUrls(
          COMPLETION_ROWS_MAX * URLS_PER_ROW,
        ),
      },
    });

  test("own copies, with every photo allowed", async () => {
    const t = limited();
    const w = await seed(t);
    const ids = await seedSolves(t, w.ann, COMPLETION_ROWS_MAX, () => w.ann);
    const rows = await rowsOf(t, "ann", ids);
    expect(rows).toHaveLength(COMPLETION_ROWS_MAX);
    expect(rows[0].thumbnailUrl).toBeTruthy();
    // What the budget assumes of a row.
    expect(rows[0].photoItems).toHaveLength(5);
    expect(rows[0].photoItems[0].srcSet?.split(", ")).toHaveLength(4);
  }, 300_000);

  test("copies that have moved on to members the viewer may no longer see", async () => {
    const t = limited();
    const w = await seed(t);
    const owners = await t.run(async (ctx) => {
      const out: Id<"users">[] = [];
      for (let i = 0; i < COMPLETION_ROWS_MAX; i++) {
        const owner = await ctx.db.insert("users", {
          clerkId: `clerk_owner_${i}`,
          email: `owner${i}@example.com`,
          name: `owner ${i}`,
          isActive: true,
          createdAt: BASE,
          updatedAt: BASE,
        });
        await ctx.db.insert("profiles", {
          memberId: owner,
          displayName: `owner ${i}`,
          visibility: "private",
          updatedAt: BASE,
        });
        out.push(owner);
      }
      return out;
    });
    const ids = await seedSolves(
      t,
      w.ann,
      COMPLETION_ROWS_MAX,
      (i) => owners[i],
    );
    const rows = await rowsOf(t, "ann", ids);
    expect(rows).toHaveLength(COMPLETION_ROWS_MAX);
    // The copy is out of reach, so the row falls back to the definition's box art.
    expect(rows[0].link?.kind).toBe("definition");
  }, 300_000);
});
