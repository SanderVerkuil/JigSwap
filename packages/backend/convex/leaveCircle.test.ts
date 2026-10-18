import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

// Alice owns the circle; Bob and Carol are candidate members. Each member's profile is PRIVATE so
// the only way to reach another member's copy is through the circle.
const seed = async (t: T) => {
  const alice = await mkUser(t, "clerk_alice");
  const bob = await mkUser(t, "clerk_bob");
  const carol = await mkUser(t, "clerk_carol");
  const puzzleAggregateId = await t.run(async (ctx) => {
    const now = Date.now();
    for (const memberId of [alice, bob, carol]) {
      await ctx.db.insert("profiles", {
        memberId,
        displayName: "Member",
        visibility: "private",
        updatedAt: now,
      });
    }
    const aggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return aggregateId;
  });
  return { alice, bob, carol, puzzleAggregateId };
};

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });
const asAlice = (t: T) => as(t, "clerk_alice");
const asBob = (t: T) => as(t, "clerk_bob");
const asCarol = (t: T) => as(t, "clerk_carol");

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

const createCircleForAlice = async (t: T) =>
  (await asAlice(t).mutation(api.sharing.createCircle.createCircle, {
    name: "Saturday Puzzlers",
  })) as string;

const addToCircle = (
  t: T,
  circleId: string,
  memberId: Id<"users">,
  permission: "ViewOnly" | "Exchange" | "Admin" = "ViewOnly",
) =>
  asAlice(t).mutation(api.sharing.addMember.addMember, {
    circleId,
    memberId,
    permission,
  });

const circleMembersOf = (t: T, circleId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("circleMembers")
      .withIndex("by_circle", (q) => q.eq("circleAggregateId", circleId))
      .collect(),
  );

const leftEvents = (t: T) =>
  t.run(async (ctx) =>
    ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", "MemberLeftCircle"))
      .collect(),
  );

// The member acquires a copy and marks it OPEN (forLend): open copies are the ones the circle path
// makes reachable in Browse.
const acquireOpenCopy = async (
  t: T,
  clerkId: string,
  puzzleAggregateId: string,
) => {
  const copyId = (await as(t, clerkId).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
  )) as string;
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
      .unique();
    if (!row) throw new Error("seed: acquired copy not found");
    await ctx.db.patch(row._id, {
      availability: { forTrade: false, forSale: false, forLend: true },
    });
  });
  return copyId;
};

const carolBrowses = async (t: T) =>
  (
    await asCarol(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    )
  ).ownedPuzzles;

describe("sharing.leaveCircle", () => {
  test("a member leaves: seat and lookup row gone, MemberLeftCircle recorded", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await addToCircle(t, circleId, bob);

    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique(),
    );
    expect(row?.memberships.some((m) => m.memberId === bob)).toBe(false);
    expect((await circleMembersOf(t, circleId)).map((l) => l.memberId)).toEqual(
      [row?.ownerId],
    );
    expect(
      await asBob(t).query(api.sharing.listMyCircles.listMyCircles, {}),
    ).toHaveLength(0);

    const events = await leftEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0].context).toBe("sharing");
    expect(events[0].payload).toEqual({
      circleId,
      memberId: bob,
      reason: "left",
    });
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);
    await expect(
      t.mutation(api.sharing.leaveCircle.leaveCircle, { circleId }),
    ).rejects.toThrow();
  });

  test("the owner cannot leave (OwnerCannotLeave)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);

    await expectConvexCode(
      asAlice(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId }),
      "OwnerCannotLeave",
    );
    expect(await circleMembersOf(t, circleId)).toHaveLength(1);
    expect(await leftEvents(t)).toHaveLength(0);
  });

  test("a non-member gets the same error as for a circle that doesn't exist", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);

    const errorOf = (id: string) =>
      asCarol(t)
        .mutation(api.sharing.leaveCircle.leaveCircle, { circleId: id })
        .then(
          () => {
            throw new Error("expected leaveCircle to fail");
          },
          (e: unknown) => {
            expect(e).toBeInstanceOf(ConvexError);
            return (e as ConvexError<Value>).data;
          },
        );

    const existing = dataOf({ data: await errorOf(circleId) });
    expect(existing).toEqual({
      code: "CircleNotFound",
      message: `Circle ${circleId} could not be found`,
    });
    // Same shape for a made-up id: only the echoed id differs.
    const missing = dataOf({ data: await errorOf("no-such-circle") });
    expect(missing).toEqual({
      code: "CircleNotFound",
      message: "Circle no-such-circle could not be found",
    });
    expect(await leftEvents(t)).toHaveLength(0);
  });

  test("an unknown circle gets CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expectConvexCode(
      asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, {
        circleId: "no-such-circle",
      }),
      "CircleNotFound",
    );
  });
});

describe("sharing.removeMember records MemberLeftCircle", () => {
  test("an admin's removal is recorded with reason removed", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await addToCircle(t, circleId, bob);

    await asAlice(t).mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });

    const events = await leftEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      circleId,
      memberId: bob,
      reason: "removed",
    });
  });
});

describe("member cap", () => {
  test("the 51st member is refused with CircleFull", async () => {
    const t = convexTest(schema, modules);
    const { carol } = await seed(t);
    const circleId = await createCircleForAlice(t);
    // The owner holds seat 1; fill seats 2..50.
    for (let i = 2; i <= 50; i += 1) {
      await addToCircle(t, circleId, await mkUser(t, `clerk_member_${i}`));
    }
    expect(await circleMembersOf(t, circleId)).toHaveLength(50);

    await expectConvexCode(addToCircle(t, circleId, carol), "CircleFull");
    expect(await circleMembersOf(t, circleId)).toHaveLength(50);
  });
});

// A departed member's copies must stop being reachable through the circle. The circle-aware policy
// lets any OPEN copy through, so without withdrawing the share links a remaining member would keep
// seeing a non-member's copy via the stale `circleCopyShares` row.
describe("a departed member's circle shares are withdrawn", () => {
  const setUp = async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, puzzleAggregateId } = await seed(t);
    const circleId = await createCircleForAlice(t);
    // Bob is an Admin so he can share his own copy; Carol is a plain member.
    await addToCircle(t, circleId, bob, "Admin");
    await addToCircle(t, circleId, carol);
    const bobsCopy = await acquireOpenCopy(t, "clerk_bob", puzzleAggregateId);
    const alicesCopy = await acquireOpenCopy(
      t,
      "clerk_alice",
      puzzleAggregateId,
    );
    await asBob(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId: bobsCopy,
    });
    await asAlice(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId: alicesCopy,
    });
    // Precondition: Carol reaches both copies through the circle only.
    const before = (await carolBrowses(t)).map((c) => c.aggregateId);
    expect(before).toContain(bobsCopy);
    expect(before).toContain(alicesCopy);
    return {
      t,
      alice,
      bob,
      carol,
      puzzleAggregateId,
      circleId,
      bobsCopy,
      alicesCopy,
    };
  };

  const sharesOf = (t: T, circleId: string) =>
    t.run(async (ctx) =>
      ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .collect(),
    );

  test("on leave, only the leaver's shares go and their copy is no longer reachable", async () => {
    const { t, circleId, bobsCopy, alicesCopy } = await setUp();

    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    expect((await sharesOf(t, circleId)).map((s) => s.copyId)).toEqual([
      alicesCopy,
    ]);
    const after = (await carolBrowses(t)).map((c) => c.aggregateId);
    expect(after).not.toContain(bobsCopy);
    expect(after).toContain(alicesCopy);
  });

  test("on removal, the removed member's shares go too", async () => {
    const { t, bob, circleId, bobsCopy, alicesCopy } = await setUp();

    await asAlice(t).mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });

    expect((await sharesOf(t, circleId)).map((s) => s.copyId)).toEqual([
      alicesCopy,
    ]);
    expect((await carolBrowses(t)).map((c) => c.aggregateId)).not.toContain(
      bobsCopy,
    );
  });

  test("at scale, leave touches only the leaver's links in this circle", async () => {
    const {
      t,
      alice,
      carol,
      puzzleAggregateId,
      circleId,
      bobsCopy,
      alicesCopy,
    } = await setUp();
    // 300 more copies from the other members, all shared into the circle, seeded directly.
    const OTHER_SHARES = 300;
    await t.run(async (ctx) => {
      const puzzle = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", puzzleAggregateId),
        )
        .unique();
      if (!puzzle) throw new Error("seed: puzzle not found");
      const now = Date.now();
      for (let i = 0; i < OTHER_SHARES; i += 1) {
        const copyId = `other-copy-${i}`;
        await ctx.db.insert("ownedPuzzles", {
          aggregateId: copyId,
          puzzleId: puzzle._id,
          ownerId: i % 2 === 0 ? alice : carol,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: true },
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("circleCopyShares", {
          circleId,
          copyId,
          sharedAt: now,
        });
      }
    });
    // Bob also shares the same copy into a circle of his own: that link must survive.
    const bobsCircle = (await asBob(t).mutation(
      api.sharing.createCircle.createCircle,
      { name: "Bob's circle" },
    )) as string;
    await asBob(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId: bobsCircle,
      copyId: bobsCopy,
    });

    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    const remaining = (await sharesOf(t, circleId)).map((s) => s.copyId);
    expect(remaining).toHaveLength(OTHER_SHARES + 1);
    expect(remaining).toContain(alicesCopy);
    expect(remaining).not.toContain(bobsCopy);
    expect((await sharesOf(t, bobsCircle)).map((s) => s.copyId)).toEqual([
      bobsCopy,
    ]);
  });

  test("a copy the leaver owns but a housemate holds still has its link removed", async () => {
    const { t, circleId, bobsCopy, alicesCopy } = await setUp();
    const housemate = await mkUser(t, "clerk_housemate");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", bobsCopy))
        .unique();
      if (!row) throw new Error("seed: Bob's copy not found");
      await ctx.db.patch(row._id, { heldBy: housemate });
    });

    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    expect((await sharesOf(t, circleId)).map((s) => s.copyId)).toEqual([
      alicesCopy,
    ]);
  });

  test("after leaving, the circle and another member's copy shared in it are out of reach", async () => {
    const { t, circleId, alicesCopy } = await setUp();
    const alicesCopyRowId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", alicesCopy))
        .unique();
      if (!row) throw new Error("seed: Alice's copy not found");
      return row._id;
    });
    const bobSeesAlicesCopy = async () =>
      (await asBob(t).query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        {
          copyId: alicesCopyRowId,
        },
      )) !== null;
    // Alice's profile is private and they don't follow each other: the circle is Bob's only path.
    expect(await bobSeesAlicesCopy()).toBe(true);

    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    expect(
      (await asBob(t).query(api.sharing.listMyCircles.listMyCircles, {})).map(
        (c) => c.aggregateId,
      ),
    ).not.toContain(circleId);
    expect(await bobSeesAlicesCopy()).toBe(false);
  });

  test("an admin can add a member back after they leave", async () => {
    const { t, bob, circleId } = await setUp();
    await asBob(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId });

    await addToCircle(t, circleId, bob);

    expect(
      (await asBob(t).query(api.sharing.listMyCircles.listMyCircles, {})).map(
        (c) => c.aggregateId,
      ),
    ).toContain(circleId);
    const links = await circleMembersOf(t, circleId);
    expect(links.filter((l) => l.memberId === bob)).toHaveLength(1);
  });
});
