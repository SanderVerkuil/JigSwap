import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Revoking a pending in-app household invite (the Members tab's pending list): admin only, the
// invitee's notification goes with it, answered and email-made invites are left alone.

type T = TestConvex<typeof schema>;

const seed = async (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      ann: await mkUser("clerk_ann", "Ann"),
      bob: await mkUser("clerk_bob", "Bob"),
      cat: await mkUser("clerk_cat", "Cat"),
    };
  });

const as = (t: T, who: "ann" | "bob" | "cat") =>
  t.withIdentity({ subject: `clerk_${who}` });

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationTypes = async (t: T, userId: Id<"users">) =>
  (
    await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    )
  ).map((n) => n.type);

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

const annInvitesBob = async (t: T, bob: Id<"users">) => {
  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  return as(t, "ann").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: bob },
  );
};

const revoke = (t: T, who: "ann" | "bob" | "cat", inviteId: string) =>
  as(t, who).mutation(
    api.household.revokeHouseholdInvite.revokeHouseholdInvite,
    {
      inviteId,
    },
  );

describe("revokeHouseholdInvite", () => {
  test("the admin revokes: the invite, its notification and the pending row go", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await flushScheduled(t);
    expect(await notificationTypes(t, bob)).toContain(
      "household_invite_received",
    );

    await revoke(t, "ann", inviteId);
    await flushScheduled(t);

    expect(await notificationTypes(t, bob)).not.toContain(
      "household_invite_received",
    );
    const mine = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(mine?.pendingInvites).toEqual([]);
    expect(
      await as(t, "bob").query(
        api.household.listMyHouseholdInvites.listMyHouseholdInvites,
        {},
      ),
    ).toEqual([]);
    await expectConvexCode(
      as(t, "bob").mutation(
        api.household.acceptHouseholdInvite.acceptHouseholdInvite,
        { inviteId },
      ),
      "InviteNotFound",
    );
    // Ann may invite Bob again afterwards.
    await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: bob },
    );
  });

  test("only the household's admin may revoke", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await expectConvexCode(revoke(t, "bob", inviteId), "NotHouseholdAdmin");
    await expectConvexCode(revoke(t, "cat", inviteId), "NotHouseholdAdmin");
    expect(
      await as(t, "bob").query(
        api.household.listMyHouseholdInvites.listMyHouseholdInvites,
        {},
      ),
    ).toHaveLength(1);
  });

  test("an answered invite stays", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await as(t, "bob").mutation(
      api.household.declineHouseholdInvite.declineHouseholdInvite,
      { inviteId },
    );
    await expectConvexCode(revoke(t, "ann", inviteId), "InviteNotPending");
  });

  test("an email invitation's in-app invite answers like an unknown one", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("householdInvites")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
        .unique();
      await ctx.db.patch(row!._id, { viaEmail: true });
    });
    await expectConvexCode(revoke(t, "ann", inviteId), "InviteNotFound");
    await expectConvexCode(revoke(t, "ann", "nope"), "InviteNotFound");
  });
});
