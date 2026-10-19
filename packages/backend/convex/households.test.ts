import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Household membership: invite → accept/decline via notifications, at most one household per
// member, admin-only invite/remove with promotion on admin leave, dissolve on last leave.

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

// Ann founds a household and invites Bob; returns the invite id.
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

describe("household invites", () => {
  test("invite notifies the invitee; accept joins and notifies the inviter", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);

    const inviteId = await annInvitesBob(t, bob);
    await flushScheduled(t);
    expect(await notificationTypes(t, bob)).toEqual([
      "household_invite_received",
    ]);

    const incoming = await as(t, "bob").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );
    expect(incoming).toHaveLength(1);
    expect(incoming[0].inviteId).toBe(inviteId);
    expect(incoming[0].inviter.name).toBe("Ann");

    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
    await flushScheduled(t);
    expect(await notificationTypes(t, ann)).toEqual([
      "household_invite_accepted",
    ]);

    const mine = await as(t, "bob").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(mine?.viewerRole).toBe("member");
    expect(mine?.members.map((m) => [m.name, m.role]).sort()).toEqual([
      ["Ann", "admin"],
      ["Bob", "member"],
    ]);
    expect(
      await as(t, "bob").query(
        api.household.listMyHouseholdInvites.listMyHouseholdInvites,
        {},
      ),
    ).toEqual([]);
  });

  test("decline is silent and does not join", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);

    const inviteId = await annInvitesBob(t, bob);
    await as(t, "bob").mutation(
      api.household.declineHouseholdInvite.declineHouseholdInvite,
      { inviteId },
    );
    await flushScheduled(t);

    expect(await notificationTypes(t, ann)).toEqual([]);
    expect(
      await as(t, "bob").query(api.household.getMyHousehold.getMyHousehold, {}),
    ).toBeNull();
    const annView = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(annView?.members.map((m) => m.name)).toEqual(["Ann"]);
    expect(annView?.pendingInvites).toEqual([]);
  });

  test("only the invitee may accept or decline", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);

    await expectConvexCode(
      as(t, "cat").mutation(
        api.household.acceptHouseholdInvite.acceptHouseholdInvite,
        { inviteId },
      ),
      "NotInvitee",
    );
    await expectConvexCode(
      as(t, "ann").mutation(
        api.household.declineHouseholdInvite.declineHouseholdInvite,
        { inviteId },
      ),
      "NotInvitee",
    );
  });

  test("the admin sees pending sent invites; a plain member does not", async () => {
    const t = convexTest(schema, modules);
    const { bob, cat } = await seed(t);
    const bobInvite = await annInvitesBob(t, bob);
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId: bobInvite },
    );
    await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: cat },
    );

    const annView = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(annView?.pendingInvites.map((i) => i.invitee.name)).toEqual(["Cat"]);
    const bobView = await as(t, "bob").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(bobView?.pendingInvites).toEqual([]);
  });
});

describe("member names", () => {
  test("a member without a name is shown without one — never by email", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const ann = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_ann"))
        .unique();
      await ctx.db.patch(row!._id, { name: undefined });
      return row!._id;
    });
    await annInvitesBob(t, bob);

    const [invite] = await as(t, "bob").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );
    expect(invite.inviter).toEqual({ memberId: ann });
    expect(JSON.stringify(invite)).not.toContain("@example.com");
  });
});

describe("at most one household", () => {
  test("cannot create a second household", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    await expectConvexCode(
      as(t, "ann").mutation(api.household.createHousehold.createHousehold, {}),
      "AlreadyInHousehold",
    );
  });

  test("cannot invite someone who is already in this household", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
    await expectConvexCode(
      as(t, "ann").mutation(api.household.inviteToHousehold.inviteToHousehold, {
        inviteeId: bob,
      }),
      "AlreadyMember",
    );
  });

  test("cannot accept after joining another household", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const annInvite = await annInvitesBob(t, bob);
    await as(t, "cat").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const catInvite = await as(t, "cat").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: bob },
    );
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId: catInvite },
    );
    await expectConvexCode(
      as(t, "bob").mutation(
        api.household.acceptHouseholdInvite.acceptHouseholdInvite,
        { inviteId: annInvite },
      ),
      "AlreadyInHousehold",
    );
  });

  test("inviting an unknown member is rejected", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    await t.run((ctx) => ctx.db.delete(bob));
    await expectConvexCode(
      as(t, "ann").mutation(api.household.inviteToHousehold.inviteToHousehold, {
        inviteeId: bob,
      }),
      "MemberNotFound",
    );
  });
});

describe("leaving, removal and dissolution", () => {
  const twoMemberHousehold = async (t: T) => {
    const ids = await seed(t);
    const inviteId = await annInvitesBob(t, ids.bob);
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
    return ids;
  };

  test("a plain member leaves; the household remains", async () => {
    const t = convexTest(schema, modules);
    await twoMemberHousehold(t);
    await as(t, "bob").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    expect(
      await as(t, "bob").query(api.household.getMyHousehold.getMyHousehold, {}),
    ).toBeNull();
    const annView = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(annView?.members.map((m) => m.name)).toEqual(["Ann"]);
  });

  test("the admin leaving promotes the remaining member", async () => {
    const t = convexTest(schema, modules);
    await twoMemberHousehold(t);
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    const bobView = await as(t, "bob").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(bobView?.viewerRole).toBe("admin");
  });

  test("the last member leaving dissolves the household and its pending invites", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const inviteId = await annInvitesBob(t, bob);
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );

    const rows = await t.run(async (ctx) => ({
      households: await ctx.db.query("households").collect(),
      members: await ctx.db.query("householdMembers").collect(),
      invites: await ctx.db.query("householdInvites").collect(),
    }));
    expect(rows).toEqual({ households: [], members: [], invites: [] });
    await expectConvexCode(
      as(t, "bob").mutation(
        api.household.acceptHouseholdInvite.acceptHouseholdInvite,
        { inviteId },
      ),
      "InviteNotFound",
    );
  });

  test("the admin removes a member; a plain member cannot remove or invite", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob, cat } = await twoMemberHousehold(t);

    await expectConvexCode(
      as(t, "bob").mutation(
        api.household.removeHouseholdMember.removeHouseholdMember,
        { memberId: ann },
      ),
      "NotHouseholdAdmin",
    );
    await expectConvexCode(
      as(t, "bob").mutation(api.household.inviteToHousehold.inviteToHousehold, {
        inviteeId: cat,
      }),
      "NotHouseholdAdmin",
    );

    await as(t, "ann").mutation(
      api.household.removeHouseholdMember.removeHouseholdMember,
      { memberId: bob },
    );
    expect(
      await as(t, "bob").query(api.household.getMyHousehold.getMyHousehold, {}),
    ).toBeNull();
  });

  test("leaving without a household is rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      as(t, "ann").mutation(api.household.leaveHousehold.leaveHousehold, {}),
      "NotInHousehold",
    );
  });
});

describe("authentication", () => {
  test("every household function requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.mutation(api.household.createHousehold.createHousehold, {}),
    ).rejects.toThrow();
    await expect(
      t.query(api.household.getMyHousehold.getMyHousehold, {}),
    ).rejects.toThrow();
    await expect(
      t.query(api.household.listMyHouseholdInvites.listMyHouseholdInvites, {}),
    ).rejects.toThrow();
  });
});
