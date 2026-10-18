import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A new circle's name is trimmed and must be 1-100 characters (InvalidCircleName otherwise). The
// cap is create-side only: a circle stored with a longer name keeps working everywhere.

type T = TestConvex<typeof schema>;
type Who = "alice" | "dave";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

// Alice and Dave follow each other, so Alice may invite Dave.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mk("alice");
    const dave = await mk("dave");
    for (const [followerId, followeeId] of [
      [alice, dave],
      [dave, alice],
    ]) {
      await ctx.db.insert("follows", {
        followerId,
        followeeId,
        createdAt: now,
      });
    }
    return { alice, dave };
  });

const create = (t: T, name: string) =>
  as(t, "alice").mutation(api.sharing.createCircle.createCircle, {
    name,
  }) as Promise<string>;

const storedName = (t: T, circleId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
          .unique()
      )?.name,
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(ConvexError);
  const data = (e as ConvexError<Value>).data;
  return (typeof data === "string" ? JSON.parse(data) : data)?.code;
};

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationTypes = (t: T, userId: Id<"users">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).map((row) => row.type),
  );

describe("sharing.createCircle name limit", () => {
  test("accepts exactly 100 characters", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const name = "x".repeat(100);
    expect(await storedName(t, await create(t, name))).toBe(name);
  });

  test("stores the name trimmed", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await storedName(t, await create(t, "  Family  "))).toBe("Family");
  });

  test.each([
    ["101 characters", "x".repeat(101)],
    ["whitespace only", "   "],
    ["empty", ""],
  ])(
    "refuses %s with InvalidCircleName and stores nothing",
    async (_, name) => {
      const t = convexTest(schema, modules);
      await seed(t);
      expect(await codeOf(create(t, name))).toBe("InvalidCircleName");
      const rows = await t.run((ctx) => ctx.db.query("circles").collect());
      expect(rows).toHaveLength(0);
    },
  );
});

describe("a circle stored with a 150-character name", () => {
  test("still loads, lists, invites, notifies and deletes", async () => {
    const t = convexTest(schema, modules);
    const { dave } = await seed(t);
    const circleId = await create(t, "Saturday Puzzlers");
    const longName = "L".repeat(150);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      await ctx.db.patch(row!._id, { name: longName });
    });

    // Lists and loads.
    const [summary] = await as(t, "alice").query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(summary.name).toBe(longName);
    const detail = await as(t, "alice").query(api.sharing.getCircle.getCircle, {
      circleId,
    });
    expect(detail?.name).toBe(longName);

    // Invites (the invitee sees and is notified of it) and admits through the domain path, which
    // saves the rehydrated circle without touching its name.
    const inviteId = (await as(t, "alice").mutation(
      api.sharing.inviteToCircle.inviteToCircle,
      { circleId, inviteeId: dave, permission: "ViewOnly" },
    )) as string;
    await flushScheduled(t);
    const [offer] = await as(t, "dave").query(
      api.sharing.listMyCircleInvites.listMyCircleInvites,
      {},
    );
    expect(offer.circleName).toBe(longName);
    expect(await notificationTypes(t, dave)).toContain(
      "circle_invite_received",
    );
    await as(t, "dave").mutation(
      api.sharing.acceptCircleInvite.acceptCircleInvite,
      { inviteId },
    );
    expect(await storedName(t, circleId)).toBe(longName);

    // Deletes by typing the long name back; the member is told.
    await as(t, "alice").mutation(api.sharing.deleteCircle.deleteCircle, {
      circleId,
      confirmName: longName,
    });
    await flushScheduled(t);
    // t.run hands back undefined as null.
    expect(await storedName(t, circleId)).toBeNull();
    expect(await notificationTypes(t, dave)).toContain("circle_deleted");
  });
});
