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

  test("a non-member gets NotAMember", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);

    await expectConvexCode(
      asCarol(t).mutation(api.sharing.leaveCircle.leaveCircle, { circleId }),
      "NotAMember",
    );
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
    return { t, alice, bob, circleId, bobsCopy, alicesCopy };
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
});
