import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// A departed member's circle seat (deactivated account) in getCircle: anonymous, with no real user
// _id anywhere in the view, and still manageable by an Admin through its membershipId.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      username: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const errorCode = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return dataOf(error).code;
};

// Alice owns the circle; Bob is a member whose account is then deactivated; Carol is a member.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  await mkUser(t, "dave");
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  await t.run((ctx) => ctx.db.patch(bob, { isActive: false }));
  return { alice, bob, carol, circleId };
};

const detailAs = (t: T, clerkId: string, circleId: string) =>
  as(t, clerkId).query(api.sharing.getCircle.getCircle, { circleId });

const seatOf = async (t: T, circleId: string, memberId: Id<"users">) =>
  (await t.run((ctx) =>
    ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .unique(),
  ))!.memberships.find((m) => m.memberId === memberId)!;

describe("a departed circle seat", () => {
  test("carries no real user id: only its membershipId and departed", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);

    const detail = await detailAs(t, "carol", circleId);
    const seat = detail!.members.find((m) => m.departed);
    expect(seat).toBeDefined();
    expect(seat!.membershipId).toBe((await seatOf(t, circleId, bob)).id);
    expect(seat!.memberId).toBeUndefined();
    expect(seat!.name).toBeUndefined();
    expect(seat!.username).toBeUndefined();
    // Nowhere in the whole view.
    expect(JSON.stringify(detail)).not.toContain(bob);
    // A current co-member keeps their id.
    expect(detail!.members.find((m) => m.memberId === carol)).toBeDefined();
  });

  test("a departed OWNER's id is nowhere in the circle views either", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(alice, { isActive: false }));

    const detail = await detailAs(t, "carol", circleId);
    expect(detail!.members.find((m) => m.isOwner)?.departed).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(alice);
    const mine = await as(t, "carol").query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toContain(alice);
  });

  test("an Admin removes it by membershipId", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const { id: membershipId } = await seatOf(t, circleId, bob);

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      membershipId,
    });
    const detail = await detailAs(t, "alice", circleId);
    expect(detail!.members.some((m) => m.membershipId === membershipId)).toBe(
      false,
    );
  });

  test("an Admin changes its permission by membershipId", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const { id: membershipId } = await seatOf(t, circleId, bob);

    await as(t, "alice").mutation(
      api.sharing.changePermission.changePermission,
      { circleId, membershipId, permission: "Exchange" },
    );
    expect((await seatOf(t, circleId, bob)).permission).toBe("Exchange");
  });

  test("a membershipId can't probe: a non-admin gets the same refusal for a real and an unknown seat", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const { id: membershipId } = await seatOf(t, circleId, bob);

    const real = await errorCode(
      as(t, "dave").mutation(api.sharing.removeMember.removeMember, {
        circleId,
        membershipId,
      }),
    );
    const unknown = await errorCode(
      as(t, "dave").mutation(api.sharing.removeMember.removeMember, {
        circleId,
        membershipId: "no-such-seat",
      }),
    );
    expect(unknown).toBe(real);
    expect(
      await errorCode(
        as(t, "dave").mutation(api.sharing.removeMember.removeMember, {
          circleId: "no-such-circle",
          membershipId,
        }),
      ),
    ).toBe("CircleNotFound");
  });

  test("exactly one of memberId and membershipId", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const { id: membershipId } = await seatOf(t, circleId, bob);

    expect(
      await errorCode(
        as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
          circleId,
        }),
      ),
    ).toBe("InvalidArgument");
    expect(
      await errorCode(
        as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
          circleId,
          memberId: bob,
          membershipId,
        }),
      ),
    ).toBe("InvalidArgument");
  });
});
