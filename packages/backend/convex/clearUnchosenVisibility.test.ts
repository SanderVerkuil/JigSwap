import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { CLEAR_UNCHOSEN_VISIBILITY_BATCH } from "./social/clearUnchosenVisibility";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Before the lazy-profile fix, editProfile/arrangeShelf stored visibility "public" the member never
// chose. The repair clears it on "public" rows whose member has no ProfileVisibilityChanged event.

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const clear = internal.social.clearUnchosenVisibility.clearUnchosenVisibility;

type Member = {
  visibility?: "public" | "private";
  // A ProfileVisibilityChanged event in the log for this member.
  chose?: "public" | "private";
};

// One member with a profiles row per entry.
const seed = (t: TestConvex<typeof schema>, members: Member[]) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"profiles">[] = [];
    for (const [i, member] of members.entries()) {
      const memberId = await ctx.db.insert("users", {
        clerkId: `clerk_${i}`,
        email: `member${i}@example.com`,
        name: `Member ${i}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const aggregateId = `profile-${i}`;
      ids.push(
        await ctx.db.insert("profiles", {
          aggregateId,
          memberId,
          visibility: member.visibility,
          updatedAt: now,
        }),
      );
      if (member.chose) {
        await ctx.db.insert("domainEvents", {
          name: "ProfileVisibilityChanged",
          payload: {
            profileId: aggregateId,
            memberId,
            visibility: member.chose,
          },
          occurredAt: now,
          context: "social",
        });
      }
    }
    return ids;
  });

const rowsOf = (t: TestConvex<typeof schema>, ids: Id<"profiles">[]) =>
  t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

// Run the first batch, then drain the self-rescheduled ones.
const runAll = async (
  t: TestConvex<typeof schema>,
  args: { apply?: boolean } = {},
) => {
  vi.useFakeTimers();
  try {
    const first = await t.mutation(clear, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return first;
  } finally {
    vi.useRealTimers();
  }
};

const MIXED: Member[] = [
  { visibility: "public" }, // lazily created: never chose
  { visibility: "public", chose: "public" }, // chose public
  { visibility: "public", chose: "private" }, // toggled private, then public again
  { visibility: "private", chose: "private" }, // chose private
  {}, // no choice stored
];

describe("social.clearUnchosenVisibility", () => {
  test("a dry run by default: counts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, MIXED);
    const before = await rowsOf(t, ids);

    const first = await runAll(t);
    expect(first).toEqual({ scanned: 5, cleared: 1, kept: 2 });
    expect(await rowsOf(t, ids)).toEqual(before);
  });

  test("apply: clears only a public row without a recorded choice, then nothing on a rerun", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, MIXED);
    const before = await rowsOf(t, ids);

    await runAll(t, { apply: true });
    const after = await rowsOf(t, ids);
    const { visibility: _cleared, ...unchosen } = before[0] as Doc<"profiles">;
    expect(after[0]).toEqual(unchosen);
    expect(after.slice(1)).toEqual(before.slice(1));

    const second = await runAll(t, { apply: true });
    expect(second).toEqual({ scanned: 5, cleared: 0, kept: 2 });
    expect(await rowsOf(t, ids)).toEqual(after);
  });

  test("walks every batch until the table is exhausted", async () => {
    const t = convexTest(schema, modules);
    const total = CLEAR_UNCHOSEN_VISIBILITY_BATCH * 2 + 7;
    const ids = await seed(
      t,
      Array.from({ length: total }, () => ({ visibility: "public" as const })),
    );

    const first = await runAll(t, { apply: true });
    expect(first.scanned).toBe(CLEAR_UNCHOSEN_VISIBILITY_BATCH);
    const after = await rowsOf(t, ids);
    expect(after.every((row) => row?.visibility === undefined)).toBe(true);

    // The last batch logs the whole run's totals.
    const lines = vi
      .mocked(console.log)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as unknown);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "social.clearUnchosenVisibility",
        dry_run: false,
        scanned: total,
        cleared: total,
        kept: 0,
      }),
    );
  });
});
