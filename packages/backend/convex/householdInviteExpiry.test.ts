import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-31: a household invite lapses 14 days after it was sent. A lapsed invite reads as missing
// everywhere: both pending lists, the quick start, the notification (expired, no actions) and
// accept (InviteNotFound). The admin may invite the member again.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob";

const DAY = 24 * 60 * 60 * 1000;

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
    };
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

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

const annInvitesBob = async (t: T, bob: Id<"users">) =>
  as(t, "ann").mutation(api.household.inviteToHousehold.inviteToHousehold, {
    inviteeId: bob,
  });

// Backdate an invite's createdAt: lapsing is read from it, never stored.
const sentAgo = (t: T, inviteId: string, ms: number) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("householdInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
      .unique();
    if (row === null) throw new Error("no such invite");
    await ctx.db.patch(row._id, { createdAt: Date.now() - ms });
  });

const incoming = (t: T) =>
  as(t, "bob").query(
    api.household.listMyHouseholdInvites.listMyHouseholdInvites,
    {},
  );

const adminPending = async (t: T) =>
  (await as(t, "ann").query(api.household.getMyHousehold.getMyHousehold, {}))
    ?.pendingInvites;

const householdStep = async (t: T) =>
  (
    await as(t, "bob").query(api.onboarding.getQuickStart.getQuickStart, {})
  ).steps.find((s) => s.id === "household");

const inviteNotification = async (t: T) => {
  const { page } = await as(t, "bob").query(
    api.notifications.listMyNotificationViews.listMyNotificationViews,
    { paginationOpts: { numItems: 30, cursor: null } },
  );
  return page.find((view) => view.type === "household_invite_received");
};

describe("household invite expiry", () => {
  test("a 13-day-old invite is still listed and can be accepted", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const inviteId = await annInvitesBob(t, bob);
    await flushScheduled(t);
    await sentAgo(t, inviteId, 13 * DAY);

    expect((await incoming(t)).map((i) => i.inviteId)).toEqual([inviteId]);
    expect((await adminPending(t))?.map((i) => i.inviteId)).toEqual([inviteId]);
    expect(await householdStep(t)).toMatchObject({ pendingInvite: true });
    expect((await inviteNotification(t))?.availableActions).toEqual([
      "accept_household_invite",
      "decline_household_invite",
    ]);
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
  });

  test("a 15-day-old invite reads as missing everywhere, and the admin can invite again", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const lapsed = await annInvitesBob(t, bob);
    await flushScheduled(t);
    await sentAgo(t, lapsed, 15 * DAY);

    expect(await incoming(t)).toEqual([]);
    expect(await adminPending(t)).toEqual([]);
    expect(await householdStep(t)).toMatchObject({ pendingInvite: false });
    const view = await inviteNotification(t);
    expect(view?.availableActions).toEqual([]);
    expect(view?.resolvedAs).toBe("expired");
    await expectConvexCode(
      as(t, "bob").mutation(
        api.household.acceptHouseholdInvite.acceptHouseholdInvite,
        { inviteId: lapsed },
      ),
      "InviteNotFound",
    );

    // No DuplicateInvite: the lapsed invite gives way to a fresh one.
    const fresh = await annInvitesBob(t, bob);
    expect(fresh).not.toBe(lapsed);
    expect((await incoming(t)).map((i) => i.inviteId)).toEqual([fresh]);
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId: fresh },
    );
    expect(
      (
        await as(t, "bob").query(
          api.household.getMyHousehold.getMyHousehold,
          {},
        )
      )?.members.map((m) => m.isYou),
    ).toContain(true);
  });

  // Accept refuses across a block, so an invite still on offer would single the block out: it reads
  // as gone, like every other invite accept refuses, with nothing block-specific anywhere.
  test.each(["ann", "bob"] as const)(
    "after %s blocks the other side the invite reads as missing everywhere",
    async (blocker) => {
      const t = convexTest(schema, modules);
      const { ann, bob } = await seed(t);
      await as(t, "ann").mutation(
        api.household.createHousehold.createHousehold,
        {},
      );
      const inviteId = await annInvitesBob(t, bob);
      await flushScheduled(t);
      const other = blocker === "ann" ? bob : ann;

      await as(t, blocker).mutation(api.social.blockMember.blockMember, {
        memberId: other,
      });

      expect(await incoming(t)).toEqual([]);
      expect(await adminPending(t)).toEqual([]);
      expect(await householdStep(t)).toMatchObject({ pendingInvite: false });
      const view = await inviteNotification(t);
      expect(view?.availableActions).toEqual([]);
      expect(view?.resolvedAs).toBe("expired");
      await expectConvexCode(
        as(t, "bob").mutation(
          api.household.acceptHouseholdInvite.acceptHouseholdInvite,
          { inviteId },
        ),
        "InviteNotFound",
      );

      // The row stays: unblocking puts an invite that has not lapsed back on offer, as with a
      // circle invite (sharing/circleAccess circleOfOpenInvite).
      await as(t, blocker).mutation(api.social.unblockMember.unblockMember, {
        memberId: other,
      });
      expect((await incoming(t)).map((i) => i.inviteId)).toEqual([inviteId]);
    },
  );

  test("the quick start still finds an open invite behind many lapsed ones", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    // Lapsed invites stay pending (lapsing is computed), one per household that ever invited
    // Bob. Seeded older than the open one, as they would be.
    await t.run(async (ctx) => {
      for (let i = 0; i < 30; i++) {
        await ctx.db.insert("householdInvites", {
          aggregateId: `lapsed-${i}`,
          householdId: `household-${i}`,
          inviterId: ann,
          inviteeId: bob,
          status: "pending",
          createdAt: Date.now() - 20 * DAY,
        });
      }
    });
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    expect(await householdStep(t)).toMatchObject({ pendingInvite: false });

    await annInvitesBob(t, bob);
    expect(await householdStep(t)).toMatchObject({ pendingInvite: true });
  });
});
