import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Leaving one household to join another in one step: an invite reaches a member of another
// household, and accepting it with leaveCurrentHousehold leaves theirs (dissolving it when they
// were its last member) and joins, all in one transaction. Without the flag, or on any refusal,
// nothing changes: the member is never in zero or two households.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

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

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  return (typeof data === "string" ? JSON.parse(data) : data)?.code;
};

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const create = (t: T, who: Who) =>
  as(t, who).mutation(api.household.createHousehold.createHousehold, {});
const invite = (t: T, who: Who, inviteeId: Id<"users">) =>
  as(t, who).mutation(api.household.inviteToHousehold.inviteToHousehold, {
    inviteeId,
  });
const accept = (t: T, who: Who, inviteId: string, leave?: boolean) =>
  as(t, who).mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    leave === undefined
      ? { inviteId }
      : { inviteId, leaveCurrentHousehold: leave },
  );
const membershipsOf = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("householdMembers")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect(),
  );

describe("invites to a member of another household", () => {
  test("the invite is sent (the inviter learns nothing) and offers only Decline inline", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await create(t, "ann");
    await create(t, "bob");
    await invite(t, "ann", bob);
    await flushScheduled(t);

    const views = (
      await as(t, "bob").query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 10, cursor: null } },
      )
    ).page.filter((v) => v.type === "household_invite_received");
    expect(views).toHaveLength(1);
    expect(views[0].availableActions).toEqual(["decline_household_invite"]);
  });

  test("accepting without leaving is refused and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await create(t, "ann");
    const bobHousehold = await create(t, "bob");
    const inviteId = await invite(t, "ann", bob);

    await expect(accept(t, "bob", inviteId)).rejects.toSatisfy(
      (e) => codeOf(e) === "AlreadyInHousehold",
    );
    const after = await membershipsOf(t, bob);
    expect(after.map((m) => m.householdId)).toEqual([bobHousehold]);
  });

  test("a sole member leaves (their household and its invites go) and joins", async () => {
    const t = convexTest(schema, modules);
    const { bob, cat } = await seed(t);
    const annHousehold = await create(t, "ann");
    const bobHousehold = await create(t, "bob");
    await invite(t, "bob", cat);
    const inviteId = await invite(t, "ann", bob);

    expect(await accept(t, "bob", inviteId, true)).toBe(annHousehold);
    expect((await membershipsOf(t, bob)).map((m) => m.householdId)).toEqual([
      annHousehold,
    ]);
    const rest = await t.run(async (ctx) => ({
      households: await ctx.db.query("households").collect(),
      invites: await ctx.db.query("householdInvites").collect(),
    }));
    expect(rest.households.map((h) => h.aggregateId)).not.toContain(
      bobHousehold,
    );
    expect(rest.invites.filter((i) => i.householdId === bobHousehold)).toEqual(
      [],
    );
  });

  test("an admin with a housemate leaves (the housemate becomes admin) and joins", async () => {
    const t = convexTest(schema, modules);
    const { bob, cat } = await seed(t);
    const annHousehold = await create(t, "ann");
    const bobHousehold = await create(t, "bob");
    await accept(t, "cat", await invite(t, "bob", cat));
    const inviteId = await invite(t, "ann", bob);

    await accept(t, "bob", inviteId, true);
    expect((await membershipsOf(t, bob)).map((m) => m.householdId)).toEqual([
      annHousehold,
    ]);
    const catNow = await membershipsOf(t, cat);
    expect(catNow.map((m) => [m.householdId, m.role])).toEqual([
      [bobHousehold, "admin"],
    ]);
  });

  test("when the target household is gone, the member stays where they were", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await create(t, "ann");
    const bobHousehold = await create(t, "bob");
    const inviteId = await invite(t, "ann", bob);
    // Ann leaves: her household dissolves and its pending invites go.
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );

    await expect(accept(t, "bob", inviteId, true)).rejects.toBeInstanceOf(
      ConvexError,
    );
    expect((await membershipsOf(t, bob)).map((m) => m.householdId)).toEqual([
      bobHousehold,
    ]);
  });

  test("a member of the inviting household cannot be invited again", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await create(t, "ann");
    await accept(t, "bob", await invite(t, "ann", bob));
    await expect(invite(t, "ann", bob)).rejects.toSatisfy(
      (e) => codeOf(e) === "AlreadyMember",
    );
  });
});
