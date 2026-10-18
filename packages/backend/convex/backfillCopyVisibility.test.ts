import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { BACKFILL_COPY_VISIBILITY_BATCH } from "./library/backfillCopyVisibility";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The one-shot visibility backfill stamps `visibility: "visible"` + the authoritative marker on
// every row that lacks the marker (legacy unset or stored "private" — never an owner's choice), and
// leaves rows that already carry the marker (an owner's possible deliberate "private") alone.

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const backfill = internal.library.backfillCopyVisibility.backfillCopyVisibility;

const seed = (
  t: TestConvex<typeof schema>,
  rows: Partial<Doc<"ownedPuzzles">>[],
) =>
  t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      clerkId: "clerk_owner",
      email: "owner@example.com",
      name: "owner",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "P",
      pieceCount: 500,
      status: "approved",
      submittedBy: owner,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const ids: Id<"ownedPuzzles">[] = [];
    for (const extra of rows) {
      ids.push(
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          createdAt: NOW,
          updatedAt: NOW,
          ...extra,
        }),
      );
    }
    return ids;
  });

const rowsOf = (t: TestConvex<typeof schema>, ids: Id<"ownedPuzzles">[]) =>
  t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

// Run the first batch, then drain the self-rescheduled ones.
const runAll = async (
  t: TestConvex<typeof schema>,
  args: { dryRun?: boolean } = {},
) => {
  vi.useFakeTimers();
  try {
    const first = await t.mutation(backfill, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return first;
  } finally {
    vi.useRealTimers();
  }
};

const MIXED: Partial<Doc<"ownedPuzzles">>[] = [
  {}, // legacy, unset
  { visibility: "private" }, // legacy, old domain default
  { visibility: "visible" }, // legacy visible, no marker
  { visibility: "private", visibilityAuthoritative: true }, // owner's choice
  { visibility: "visible", visibilityAuthoritative: true }, // already migrated
];

describe("library.backfillCopyVisibility", () => {
  test("dry run reports counts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, MIXED);
    const before = await rowsOf(t, ids);

    const first = await runAll(t, { dryRun: true });
    expect(first).toEqual({
      scanned: 5,
      patched: 3,
      skipped: 2,
      wasPrivate: 1,
    });
    expect(await rowsOf(t, ids)).toEqual(before);
  });

  test("real run stamps visible + marker on unmarked rows and leaves marked rows untouched", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, MIXED);
    const before = await rowsOf(t, ids);

    await runAll(t);
    const after = await rowsOf(t, ids);
    for (const i of [0, 1, 2]) {
      expect(after[i]).toEqual({
        ...before[i],
        visibility: "visible",
        visibilityAuthoritative: true,
      });
    }
    expect(after[3]).toEqual(before[3]);
    expect(after[4]).toEqual(before[4]);
  });

  test("is idempotent: a second run patches nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, MIXED);
    await runAll(t);
    const migrated = await rowsOf(t, ids);
    const second = await runAll(t);
    expect(second.patched).toBe(0);
    expect(second.skipped).toBe(5);
    expect(await rowsOf(t, ids)).toEqual(migrated);
  });

  test("walks multiple batches until the table is exhausted", async () => {
    const t = convexTest(schema, modules);
    const total = BACKFILL_COPY_VISIBILITY_BATCH * 2 + 7;
    const ids = await seed(
      t,
      Array.from({ length: total }, (_, i) =>
        i % 2 === 0 ? { visibility: "private" as const } : {},
      ),
    );
    const first = await runAll(t);
    expect(first.scanned).toBe(BACKFILL_COPY_VISIBILITY_BATCH);
    const after = await rowsOf(t, ids);
    expect(
      after.every(
        (r) => r?.visibility === "visible" && r.visibilityAuthoritative,
      ),
    ).toBe(true);

    // The last batch logs the whole run's totals.
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[1]));
    const final = JSON.parse(lines.find((l) => l.includes('"isDone":true'))!);
    expect(final.totals).toEqual({
      scanned: total,
      patched: total,
      skipped: 0,
      wasPrivate: Math.ceil(total / 2),
    });
  });
});
