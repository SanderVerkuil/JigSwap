import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Rows as the buggy Clerk sync (`${first_name} ${last_name}`) and the old lazy profile creation
// ("Member" placeholder / copied account name) left them.
const seed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string, username?: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        username,
        searchableName: [name, username]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const nullNull = await mkUser("c_nn", "null null", "puzzler");
    const half = await mkUser("c_half", "Mara null");
    const real = await mkUser("c_real", "Jan Jansen");
    const mkProfile = (memberId: Id<"users">, displayName: string) =>
      ctx.db.insert("profiles", {
        aggregateId: `p_${memberId}`,
        memberId,
        displayName,
        updatedAt: now,
      });
    const pNullNull = await mkProfile(nullNull, "null null");
    const pHalf = await mkProfile(half, "Mara null");
    const pReal = await mkProfile(real, "Member"); // chosen by a named member: kept
    const blank = await mkUser("c_blank", " ");
    const pPlaceholder = await mkProfile(blank, "Member"); // seeded placeholder
    return {
      nullNull,
      half,
      real,
      blank,
      pNullNull,
      pHalf,
      pReal,
      pPlaceholder,
    };
  });

const runToCompletion = async (
  t: ReturnType<typeof convexTest>,
  table: "users" | "profiles",
) => {
  let cursor: string | undefined;
  let patched = 0;
  for (;;) {
    const page = await t.mutation(internal.users.backfillMemberNames, {
      table,
      batchSize: 2,
      cursor,
    });
    patched += page.patched;
    if (page.isDone) return patched;
    cursor = page.continueCursor ?? undefined;
  }
};

describe("users/backfillMemberNames", () => {
  test('cleans legacy "null" names on users and profiles, and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    // Users first (the profile pass reads the cleaned account name).
    expect(await runToCompletion(t, "users")).toBe(3);
    expect(await runToCompletion(t, "profiles")).toBe(3);

    const read = () =>
      t.run(async (ctx) => ({
        nullNull: await ctx.db.get(ids.nullNull),
        half: await ctx.db.get(ids.half),
        real: await ctx.db.get(ids.real),
        blank: await ctx.db.get(ids.blank),
        pNullNull: await ctx.db.get(ids.pNullNull),
        pHalf: await ctx.db.get(ids.pHalf),
        pReal: await ctx.db.get(ids.pReal),
        pPlaceholder: await ctx.db.get(ids.pPlaceholder),
      }));
    const after = await read();

    expect(after.nullNull?.name).toBeUndefined();
    expect(after.nullNull?.searchableName).toBe("puzzler");
    expect(after.half?.name).toBe("Mara");
    expect(after.half?.searchableName).toBe("mara");
    expect(after.real?.name).toBe("Jan Jansen");
    expect(after.blank?.name).toBeUndefined();
    expect(after.pNullNull?.displayName).toBeUndefined();
    expect(after.pHalf?.displayName).toBe("Mara");
    expect(after.pReal?.displayName).toBe("Member");
    expect(after.pPlaceholder?.displayName).toBeUndefined();

    // Second run: nothing left to patch, rows unchanged.
    expect(await runToCompletion(t, "users")).toBe(0);
    expect(await runToCompletion(t, "profiles")).toBe(0);
    expect(await read()).toEqual(after);
  });
});
