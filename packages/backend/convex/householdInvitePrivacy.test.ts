import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-10 (SHARE-4): the household invite flow named a private member by their ACCOUNT name, the
// name their chosen profile display name ("pseudonym") hides. Household reads now show the name
// other members see everywhere else (memberDisplayNameOf with the profile), and an admin can only
// invite a member the invite picker (searchUsers) could show them: a public profile or a mutual
// follower. Anyone else reads as MemberNotFound, the same answer as a missing id.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (key: string, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${key}`,
        email: `${key}@example.com`,
        name,
        username: key,
        avatar: `https://img.example.com/${key}.png`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const attacker = await mkUser("attacker", "Attacker Account");
    const victim = await mkUser("victim", "Real Fullname");
    for (const [memberId, displayName] of [
      [attacker, "Admin Pseudonym"],
      [victim, "Pseudonym"],
    ] as const) {
      await ctx.db.insert("profiles", {
        memberId,
        displayName,
        visibility: "private",
        updatedAt: now,
      });
    }
    return { attacker, victim };
  });

const as = (t: T, key: string) => t.withIdentity({ subject: `clerk_${key}` });

const follow = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    for (const [followerId, followeeId] of [
      [a, b],
      [b, a],
    ]) {
      await ctx.db.insert("follows", {
        followerId,
        followeeId,
        createdAt: Date.now(),
      });
    }
  });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  return (typeof data === "string" ? JSON.parse(data) : data)?.code;
};

const invite = async (t: T, inviteeId: Id<"users">) => {
  await as(t, "attacker").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  return as(t, "attacker").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId },
  );
};

describe("SEC-10: household invites respect a private profile", () => {
  test("inviting a private stranger reads as a missing member, and nothing is stored", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const error = await invite(t, u.victim).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect(codeOf(error)).toBe("MemberNotFound");
    const invites = await t.run((ctx) =>
      ctx.db.query("householdInvites").collect(),
    );
    expect(invites).toEqual([]);
    const notifications = await t.run((ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notifications).toEqual([]);
  });

  test("a mutual follower can be invited, and both sides see display names, not account names", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await follow(t, u.attacker, u.victim);
    await invite(t, u.victim);

    const household = await as(t, "attacker").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(household?.pendingInvites.map((i) => i.invitee)).toEqual([
      {
        memberId: u.victim,
        name: "Pseudonym",
        avatar: "https://img.example.com/victim.png",
      },
    ]);
    expect(household?.members.map((m) => m.name)).toEqual(["Admin Pseudonym"]);
    expect(JSON.stringify(household)).not.toContain("Real Fullname");

    const incoming = await as(t, "victim").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );
    expect(incoming.map((i) => i.inviter.name)).toEqual(["Admin Pseudonym"]);
    expect(JSON.stringify(incoming)).not.toContain("Attacker Account");
  });

  test("a member with a public profile can be invited without following", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", u.victim))
        .unique();
      await ctx.db.patch(profile!._id, { visibility: "public" });
    });
    await expect(invite(t, u.victim)).resolves.toEqual(expect.any(String));
  });

  test("a household link names a private admin by their display name, not their account name", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await as(t, "attacker").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const { token } = await as(t, "attacker").mutation(
      api.social.createHouseholdInviteLink.createHouseholdInviteLink,
      {},
    );
    const landing = await as(t, "victim").query(
      api.social.getHouseholdLinkInvite.getHouseholdLinkInvite,
      { token },
    );
    expect(landing).toEqual({
      state: "can-accept",
      inviterName: "Admin Pseudonym",
    });
  });
});
