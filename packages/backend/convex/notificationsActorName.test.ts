import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The subscriber snapshots the actor's name into `params.actorName`. It must follow the shared
// display-name rules: the member-chosen profile display name first, then the account name or
// username, and never the email (the recipient is another member).
const followAndRead = async (follower: {
  name?: string;
  username?: string;
  displayName?: string;
}) => {
  const t = convexTest(schema, modules);
  return t.run(async (ctx) => {
    const now = Date.now();
    const followerId = await ctx.db.insert("users", {
      clerkId: "clerk_follower",
      email: "follower@example.com",
      ...(follower.name ? { name: follower.name } : {}),
      ...(follower.username ? { username: follower.username } : {}),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const followeeId = await ctx.db.insert("users", {
      clerkId: "clerk_followee",
      email: "followee@example.com",
      name: "Followee",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    if (follower.displayName !== undefined) {
      await ctx.db.insert("profiles", {
        memberId: followerId,
        displayName: follower.displayName,
        updatedAt: now,
      });
    }
    const eventId = await ctx.db.insert("domainEvents", {
      name: "MemberFollowed",
      payload: { followerId, followeeId },
      occurredAt: now,
      context: "social",
    });
    await handleDomainEvent(
      ctx,
      (await ctx.db.get(eventId)) as Doc<"domainEvents">,
    );
    const rows = await ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("userId"), followeeId as Id<"users">))
      .collect();
    return rows.filter((r) => r.type === "new_follower");
  });
};

describe("notifications subscriber actor name", () => {
  test("uses the follower's profile display name over the account name", async () => {
    const rows = await followAndRead({
      name: "Clerk Name",
      displayName: "Mara",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.params).toEqual({ actorName: "Mara" });
  });

  test("falls back to the account name without a profile display name", async () => {
    const rows = await followAndRead({ name: "Clerk Name" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.params).toEqual({ actorName: "Clerk Name" });
    }
  });

  test("never stores the email when the member has no name", async () => {
    const rows = await followAndRead({});
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.params?.actorName).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain("follower@example.com");
    }
  });
});
