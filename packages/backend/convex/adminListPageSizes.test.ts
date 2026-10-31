import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The admin lists are admin-gated, but a page size from the client is still only a request
// (PERF-B9, SEC-49): each one clamps it server-side like the member-facing queries do.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

// More rows than any admin page may hold.
const ROWS = 60;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ada = await ctx.db.insert("users", {
      clerkId: "clerk_ada",
      email: "ada@example.com",
      name: "Ada",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const members: Id<"users">[] = [];
    for (let i = 0; i < ROWS; i++) {
      members.push(
        await ctx.db.insert("users", {
          clerkId: `clerk_m${i}`,
          email: `m${i}@example.com`,
          name: `Member ${i}`,
          isActive: true,
          createdAt: now + i,
          updatedAt: now + i,
        }),
      );
      await ctx.db.insert("puzzles", {
        title: `Puzzle ${i}`,
        pieceCount: 500,
        status: "approved",
        submittedBy: ada,
        createdAt: now + i,
        updatedAt: now + i,
      });
      await ctx.db.insert("reports", {
        reporterId: ada,
        targetKind: "user",
        targetId: members[i]!,
        reportedUserId: members[i]!,
        reason: "spam_scam",
        evidence: {},
        status: "open",
        createdAt: now + i,
      });
    }
    for (let i = 0; i < 2 * ROWS; i++) {
      await ctx.db.insert("moderationActions", {
        actorId: ada,
        kind: "definition_approved",
        targetLabel: `Puzzle ${i}`,
        targetId: `p${i}`,
        at: now + i,
      });
    }
  });

const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const huge = { paginationOpts: { numItems: 1e6, cursor: null } };
const notANumber = { paginationOpts: { numItems: Number.NaN, cursor: null } };

describe("admin list page sizes are clamped server-side", () => {
  test("listUsers: at most 50 per page", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const page = await asAdmin(t).query(api.admin.listUsers.listUsers, huge);
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
    const fallback = await asAdmin(t).query(
      api.admin.listUsers.listUsers,
      notANumber,
    );
    expect(fallback.page).toHaveLength(50);
  });

  test("listReports: at most 50 per page", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const page = await asAdmin(t).query(api.admin.listReports.listReports, {
      status: "open",
      ...huge,
    });
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
  });

  test("listPuzzleDefinitions: at most 50 per page", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const page = await asAdmin(t).query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      huge,
    );
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
  });

  test("getModerationActivity: default 30, at most 100, at least 1", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const activity = (limit?: number) =>
      asAdmin(t).query(
        api.admin.getModerationActivity.getModerationActivity,
        limit === undefined ? {} : { limit },
      );
    expect(await activity()).toHaveLength(30);
    expect(await activity(1e6)).toHaveLength(100);
    expect(await activity(Number.NaN)).toHaveLength(30);
    expect(await activity(0)).toHaveLength(1);
    expect(await activity(-4)).toHaveLength(1);
  });
});
