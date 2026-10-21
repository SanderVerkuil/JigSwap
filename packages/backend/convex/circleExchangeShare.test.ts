import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Sharing a copy into a circle: a member with Exchange or Admin may share their OWN copies; ViewOnly
// may not, and nobody may share a copy they don't own. A member later moved to ViewOnly keeps the
// shares they made; removing them from the circle ends those shares.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Level = "ViewOnly" | "Exchange" | "Admin";

// Alice owns the circle; Bob and Carol are members at the level each test needs. Every profile is
// private, so a copy is reachable only through the circle.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (who: string) => {
      const id = await ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        memberId: id,
        displayName: who,
        visibility: "private",
        updatedAt: now,
      });
      return id;
    };
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      searchableText: "Mountain Vista",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, carol, puzzleAggregateId };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

const circleWith = async (t: T, s: Seeded, bobLevel: Level) => {
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Saturday Puzzlers" },
  )) as string;
  await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
    circleId,
    memberId: s.bob,
    permission: bobLevel,
  });
  await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
    circleId,
    memberId: s.carol,
    permission: "ViewOnly",
  });
  return circleId;
};

// An OPEN copy (forLend) for `who`, returned as its CopyId (aggregateId).
const openCopyFor = async (t: T, s: Seeded, who: string) => {
  const copyId = (await as(t, who).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: s.puzzleAggregateId, condition: "good" },
  )) as string;
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
      .unique();
    await ctx.db.patch(row!._id, {
      availability: { forTrade: false, forSale: false, forLend: true },
    });
  });
  return copyId;
};

const share = (t: T, who: string, circleId: string, copyId: string) =>
  as(t, who).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
    circleId,
    copyId,
  });

const carolSees = async (t: T, copyId: string) =>
  (
    await as(t, "carol").query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    )
  ).ownedPuzzles.some((c) => c.aggregateId === copyId);

const shareCount = (t: T) =>
  t.run(
    async (ctx) => (await ctx.db.query("circleCopyShares").collect()).length,
  );

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe("sharing a copy into a circle by level", () => {
  test.each(["Exchange", "Admin"] as const)(
    "a member with %s shares their own copy",
    async (level) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const circleId = await circleWith(t, s, level);
      const copyId = await openCopyFor(t, s, "bob");

      await share(t, "bob", circleId, copyId);
      expect(await shareCount(t)).toBe(1);
      expect(await carolSees(t, copyId)).toBe(true);
    },
  );

  test("a ViewOnly member cannot share", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const circleId = await circleWith(t, s, "ViewOnly");
    const copyId = await openCopyFor(t, s, "bob");

    const error = await errorOf(share(t, "bob", circleId, copyId));
    expect(error).toBeInstanceOf(ConvexError);
    expect(dataOf(error).code).toBe("CannotShareCopy");
    expect(await shareCount(t)).toBe(0);
  });

  test("an Exchange member cannot share someone else's copy", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const circleId = await circleWith(t, s, "Exchange");
    const carolsCopy = await openCopyFor(t, s, "carol");

    await expect(share(t, "bob", circleId, carolsCopy)).rejects.toBeInstanceOf(
      ConvexError,
    );
    expect(await shareCount(t)).toBe(0);
  });

  test("a member moved to ViewOnly keeps the shares they made", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const circleId = await circleWith(t, s, "Exchange");
    const copyId = await openCopyFor(t, s, "bob");
    await share(t, "bob", circleId, copyId);

    await as(t, "alice").mutation(
      api.sharing.changePermission.changePermission,
      {
        circleId,
        memberId: s.bob as Id<"users">,
        permission: "ViewOnly",
      },
    );
    expect(await carolSees(t, copyId)).toBe(true);
    // ...but cannot share another one.
    const second = await openCopyFor(t, s, "bob");
    expect(dataOf(await errorOf(share(t, "bob", circleId, second))).code).toBe(
      "CannotShareCopy",
    );
  });

  test("an Admin removing the member ends their shares", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const circleId = await circleWith(t, s, "Exchange");
    const copyId = await openCopyFor(t, s, "bob");
    await share(t, "bob", circleId, copyId);

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: s.bob,
    });
    expect(await carolSees(t, copyId)).toBe(false);
  });
});
