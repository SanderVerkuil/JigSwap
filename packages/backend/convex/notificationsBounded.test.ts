import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
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
