import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { COMPLETION_LIST_CAP } from "./solving/listMyCompletions";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

describe("solving.listMyCompletions is bounded (PERF-B13)", () => {
  test("returns the newest COMPLETION_LIST_CAP completions, newest first", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const me = await ctx.db.insert("users", {
        clerkId: "clerk_me",
        email: "me@example.com",
        name: "Me",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const inserted: Id<"completions">[] = [];
      for (let i = 0; i <= COMPLETION_LIST_CAP; i++) {
        inserted.push(
          await ctx.db.insert("completions", {
            userId: me,
            startDate: now + i,
            endDate: now + i,
            photos: [],
            isCompleted: true,
            createdAt: now + i,
            updatedAt: now + i,
          }),
        );
      }
      return inserted;
    });

    const rows = await t
      .withIdentity({ subject: "clerk_me" })
      .query(api.solving.listMyCompletions.listMyCompletions, {});

    expect(rows).toHaveLength(COMPLETION_LIST_CAP);
    // The single oldest completion is the one dropped.
    expect(rows.map((r) => r._id)).toEqual(ids.slice(1).reverse());
  });
});
