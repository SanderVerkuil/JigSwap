import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seedMember = (t: T, clerkId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

// Insert `count` notifications for a member straight into the table (the producers are not under
// test here). `legacy` rows predate the domain path: no aggregateId, no channel.
const seedNotifications = (
  t: T,
  userId: Id<"users">,
  count: number,
  {
    isRead = false,
    legacy = false,
  }: { isRead?: boolean; legacy?: boolean } = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("notifications", {
        ...(legacy
          ? {}
          : { aggregateId: crypto.randomUUID(), channel: "inApp" }),
        userId,
        type: "new_follower",
        isRead,
        createdAt: now - i,
      });
    }
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

// Exact unread/read tallies for a member, read straight from the table (the public count is capped).
const tally = (t: T, userId: Id<"users">) =>
  t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return {
      unread: rows.filter((row) => !row.isRead).length,
      read: rows.filter((row) => row.isRead).length,
    };
  });

// Mark all read as the member, then drain the self-scheduled continuation batches.
const markAllReadAndDrain = async (
  t: T,
  clerkId: string,
  userId: Id<"users">,
) => {
  vi.useFakeTimers();
  try {
    const marked = await as(t, clerkId).mutation(
      api.notifications.markAllRead.markAllRead,
      {},
    );
    const { unread: unreadAfterFirstCall } = await tally(t, userId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return { marked, unreadAfterFirstCall };
  } finally {
    vi.useRealTimers();
  }
};

describe("unreadCount is bounded", () => {
  test("counts exactly below the cap", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedNotifications(t, ann, 7);
    await seedNotifications(t, ann, 3, { isRead: true });

    expect(
      await as(t, "clerk_ann").query(
        api.notifications.unreadCount.unreadCount,
        {},
      ),
    ).toBe(7);
  });

  test("stops counting at the cap, which reads as '100 or more'", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedNotifications(t, ann, 150);

    expect(
      await as(t, "clerk_ann").query(
        api.notifications.unreadCount.unreadCount,
        {},
      ),
    ).toBe(100);
  });
});

describe("markAllRead works in bounded batches", () => {
  test("a small inbox is cleared in the one call", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedNotifications(t, ann, 12);

    const { marked, unreadAfterFirstCall } = await markAllReadAndDrain(
      t,
      "clerk_ann",
      ann,
    );

    expect(marked).toBe(12);
    expect(unreadAfterFirstCall).toBe(0);
    expect(await tally(t, ann)).toEqual({ unread: 0, read: 12 });
  });

  test("marks 500 in the call and the rest in scheduled batches", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedNotifications(t, ann, 1200);

    const { marked, unreadAfterFirstCall } = await markAllReadAndDrain(
      t,
      "clerk_ann",
      ann,
    );

    expect(marked).toBe(500);
    expect(unreadAfterFirstCall).toBe(700);
    expect(await tally(t, ann)).toEqual({ unread: 0, read: 1200 });
    expect(
      await as(t, "clerk_ann").query(
        api.notifications.unreadCount.unreadCount,
        {},
      ),
    ).toBe(0);
  });

  test("legacy rows without an aggregateId are marked read too", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    await seedNotifications(t, ann, 3);
    await seedNotifications(t, ann, 4, { legacy: true });

    await markAllReadAndDrain(t, "clerk_ann", ann);

    expect(await tally(t, ann)).toEqual({ unread: 0, read: 7 });
  });

  test("another member's notifications are untouched", async () => {
    const t = convexTest(schema, modules);
    const ann = await seedMember(t, "clerk_ann");
    const ben = await seedMember(t, "clerk_ben");
    await seedNotifications(t, ann, 600);
    await seedNotifications(t, ben, 5);
    await seedNotifications(t, ben, 2, { legacy: true });

    await markAllReadAndDrain(t, "clerk_ann", ann);

    expect(await tally(t, ann)).toEqual({ unread: 0, read: 600 });
    expect(await tally(t, ben)).toEqual({ unread: 7, read: 0 });
  });

  test("an anonymous caller is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.notifications.markAllRead.markAllRead, {}),
    ).rejects.toThrow();
  });
});
