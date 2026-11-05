import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { FOLLOW_LIST_CAP } from "./social/readViews";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// One hub member with FOLLOW_LIST_CAP + 1 counterparties, the edges inserted oldest first. `direction`
// says whether the counterparties follow the hub ("followers") or the hub follows them ("followees").
const seedHub = (
  t: TestConvex<typeof schema>,
  direction: "followers" | "followees",
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const hub = await mkUser("clerk_hub");
    const others: Id<"users">[] = [];
    for (let i = 0; i <= FOLLOW_LIST_CAP; i++) {
      const other = await mkUser(`clerk_other_${i}`);
      await ctx.db.insert("follows", {
        followerId: direction === "followers" ? other : hub,
        followeeId: direction === "followers" ? hub : other,
        createdAt: now + i,
      });
      others.push(other);
    }
    return { hub, others };
  });

const asHub = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_hub" });

describe("follow lists are bounded (PERF-B13)", () => {
  test("listFollowers keeps the newest FOLLOW_LIST_CAP edges, still oldest-first", async () => {
    const t = convexTest(schema, modules);
    const { others } = await seedHub(t, "followers");

    const edges = await asHub(t).query(
      api.social.listFollowers.listFollowers,
      {},
    );

    expect(edges).toHaveLength(FOLLOW_LIST_CAP);
    // The single oldest edge is the one dropped; the order callers saw before is kept.
    expect(edges.map((e) => e.memberId)).toEqual(
      others.slice(1).map((id) => id as string),
    );
  });

  test("listFollowees keeps the newest FOLLOW_LIST_CAP edges, still oldest-first", async () => {
    const t = convexTest(schema, modules);
    const { others } = await seedHub(t, "followees");

    const edges = await asHub(t).query(
      api.social.listFollowees.listFollowees,
      {},
    );

    expect(edges).toHaveLength(FOLLOW_LIST_CAP);
    expect(edges.map((e) => e.memberId)).toEqual(
      others.slice(1).map((id) => id as string),
    );
  });
});
