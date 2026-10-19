import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// notifications/backfillCirclePushDefault (#292): rows materialised while circle message push was
// on by default stored the untouched default triple {inApp: true, email: false, push: true}. The
// backfill drops `push` from exactly that triple so the new off default applies, and leaves every
// explicit choice (any other triple) and rows without the key alone.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The backfill reschedules itself via runAfter(0); yield a macrotask then drain, a few times.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const UPDATED_AT = 1_000;

// Each member's stored circle_message_received entry (undefined = no key for the type).
// Seeded in this order; the reset case is last so the paging test only reaches it in a later batch.
const CASES = {
  // Explicit choices: kept.
  pushAndEmail: { inApp: true, email: true, push: true },
  pushOff: { inApp: true, email: false, push: false },
  inAppOff: { inApp: false, email: false, push: true },
  // Written before #278: no key, already resolves to the new default.
  noKey: undefined,
  // The untouched old default: reset.
  oldDefault: { inApp: true, email: false, push: true },
} as const;
type Case = keyof typeof CASES;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const ids = {} as Record<Case, Id<"users">>;
    for (const name of Object.keys(CASES) as Case[]) {
      const memberId = await ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
      });
      const circle = CASES[name];
      await ctx.db.insert("notificationPreferences", {
        aggregateId: `pref_${name}`,
        memberId,
        toggles: {
          message_received: { inApp: true, email: false, push: false },
          ...(circle ? { circle_message_received: circle } : {}),
        },
        updatedAt: UPDATED_AT,
      });
      ids[name] = memberId;
    }
    return ids;
  });

const rowOf = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
  );

const circlePushOf = async (t: T, name: Case) =>
  (
    await t
      .withIdentity({ subject: `clerk_${name}` })
      .query(api.notifications.getMyPreferences.getMyPreferences, {})
  ).circle_message_received.push;

const run = (t: T, args: { dryRun?: boolean; batchSize?: number }) =>
  t.mutation(
    internal.notifications.backfillCirclePushDefault.backfillCirclePushDefault,
    args,
  );

describe("backfillCirclePushDefault", () => {
  test("dry run is the default: counts the old default triple and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const before = await Promise.all(
      (Object.keys(CASES) as Case[]).map((name) => rowOf(t, ids[name])),
    );

    expect(await run(t, {})).toEqual({ scanned: 5, reset: 1 });
    await flush(t);

    const after = await Promise.all(
      (Object.keys(CASES) as Case[]).map((name) => rowOf(t, ids[name])),
    );
    expect(after).toEqual(before);
    expect(await circlePushOf(t, "oldDefault")).toBe(true);
  });

  test("a real run resets only the untouched default triple, leaving updatedAt alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    expect(await run(t, { dryRun: false })).toEqual({ scanned: 5, reset: 1 });
    await flush(t);

    const reset = await rowOf(t, ids.oldDefault);
    expect(reset?.toggles.circle_message_received).toEqual({
      inApp: true,
      email: false,
    });
    expect(reset?.toggles.message_received).toEqual({
      inApp: true,
      email: false,
      push: false,
    });
    expect(reset?.updatedAt).toBe(UPDATED_AT);
    expect(await circlePushOf(t, "oldDefault")).toBe(false);

    // Explicit choices keep their stored triple; the keyless row stays keyless.
    for (const name of ["pushAndEmail", "pushOff", "inAppOff"] as const) {
      expect(
        (await rowOf(t, ids[name]))?.toggles.circle_message_received,
      ).toEqual(CASES[name]);
    }
    expect(await circlePushOf(t, "pushAndEmail")).toBe(true);
    expect(await circlePushOf(t, "inAppOff")).toBe(true);
    expect(
      (await rowOf(t, ids.noKey))?.toggles.circle_message_received,
    ).toBeUndefined();
    expect(await circlePushOf(t, "noKey")).toBe(false);

    // Idempotent: a second run resets nothing new.
    expect(await run(t, { dryRun: false })).toEqual({ scanned: 5, reset: 0 });
  });

  test("pages through every row in small batches", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    // The first batch only sees two explicit rows; the old default arrives via a rescheduled batch.
    expect(await run(t, { dryRun: false, batchSize: 2 })).toEqual({
      scanned: 2,
      reset: 0,
    });
    await flush(t);

    expect(
      (await rowOf(t, ids.oldDefault))?.toggles.circle_message_received,
    ).toEqual({ inApp: true, email: false });
    expect(
      (await rowOf(t, ids.pushOff))?.toggles.circle_message_received,
    ).toEqual(CASES.pushOff);
    vi.restoreAllMocks();
  });
});
