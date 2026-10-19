import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The household admin's pending list beyond in-app invites: every pending email invitation to the
// household (whoever of its admins sent it, so also after a handover) and the open single-use
// invite links, each revocable by the current admin only. Never an address or a token.

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

const DAY = 24 * 60 * 60 * 1000;

// Ann founds a household; Bob joins it (via an accepted invite).
const annAndBob = async (t: T, bob: Id<"users">) => {
  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "ann").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: bob },
  );
  await as(t, "bob").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
  const mine = await as(t, "ann").query(
    api.household.getMyHousehold.getMyHousehold,
    {},
  );
  return mine!.householdId;
};

const seedEmailInvite = (
  t: T,
  inviterId: Id<"users">,
  householdId: string,
  ref: string,
  expiresAt = Date.now() + 14 * DAY,
) =>
  t.run((ctx) =>
    ctx.db.insert("emailInvites", {
      aggregateId: ref,
      kind: "household",
      inviterId,
      householdId,
      createdAt: Date.now(),
      expiresAt,
    }),
  );

const listEmail = (t: T, who: "ann" | "bob" | "cat") =>
  as(t, who).query(
    api.invitations.listHouseholdEmailInvites.listHouseholdEmailInvites,
    {},
  );
const revokeEmail = (t: T, who: "ann" | "bob" | "cat", inviteRef: string) =>
  as(t, who).action(api.invitations.revokeEmailInvite.revokeEmailInvite, {
    inviteRef,
  });

describe("household email invitations for every admin", () => {
  test("the admin sees every pending one to the household, without addresses", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    const householdId = await annAndBob(t, bob);
    await seedEmailInvite(t, ann, householdId, "e1");
    await seedEmailInvite(t, ann, householdId, "lapsed", Date.now() - 1);
    await seedEmailInvite(t, ann, "another-household", "elsewhere");

    const rows = await listEmail(t, "ann");
    expect(rows.map((r) => r.inviteRef)).toEqual(["e1"]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "inviteRef",
      "kind",
    ]);
    // A member who is not the admin, and an outsider, see nothing.
    expect(await listEmail(t, "bob")).toEqual([]);
    expect(await listEmail(t, "cat")).toEqual([]);
  });

  test("after a handover the new admin sees and revokes the old admin's invitation", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    const householdId = await annAndBob(t, bob);
    await seedEmailInvite(t, ann, householdId, "e1");
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );

    expect((await listEmail(t, "bob")).map((r) => r.inviteRef)).toEqual(["e1"]);
    await revokeEmail(t, "bob", "e1");
    expect(await listEmail(t, "bob")).toEqual([]);
  });

  test("nobody but the sender or the household's admin may revoke", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    const householdId = await annAndBob(t, bob);
    await seedEmailInvite(t, ann, householdId, "e1");
    await expectConvexCode(
      revokeEmail(t, "bob", "e1"),
      "EmailInviteUnavailable",
    );
    await expectConvexCode(
      revokeEmail(t, "cat", "e1"),
      "EmailInviteUnavailable",
    );
    expect(await listEmail(t, "ann")).toHaveLength(1);
  });
});

const createLink = (t: T) =>
  as(t, "ann").mutation(
    api.social.createHouseholdInviteLink.createHouseholdInviteLink,
    {},
  );
const listLinks = (t: T, who: "ann" | "bob" | "cat") =>
  as(t, who).query(api.household.listOpenInviteLinks.listOpenInviteLinks, {});
const revokeLink = (t: T, who: "ann" | "bob" | "cat", linkId: string) =>
  as(t, who).mutation(api.household.revokeInviteLink.revokeInviteLink, {
    linkId: linkId as Id<"inviteLinks">,
  });

describe("open household invite links", () => {
  test("the admin sees open links only, never the token", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await annAndBob(t, bob);
    const open = await createLink(t);
    const used = await createLink(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", used.token))
        .unique();
      await ctx.db.patch(row!._id, { consumedAt: Date.now() });
    });

    const links = await listLinks(t, "ann");
    expect(links).toHaveLength(1);
    expect(links[0].expiresAt).toBe(open.expiresAt);
    expect(JSON.stringify(links)).not.toContain(open.token);
    expect(await listLinks(t, "bob")).toEqual([]);
    expect(await listLinks(t, "cat")).toEqual([]);
  });

  test("the admin revokes one: it leaves the list and the landing reads it as invalid", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await annAndBob(t, bob);
    const { token } = await createLink(t);
    const [link] = await listLinks(t, "ann");

    await expectConvexCode(
      revokeLink(t, "bob", link.linkId),
      "NotHouseholdAdmin",
    );
    await expectConvexCode(
      revokeLink(t, "cat", link.linkId),
      "NotHouseholdAdmin",
    );
    await revokeLink(t, "ann", link.linkId);

    expect(await listLinks(t, "ann")).toEqual([]);
    const landing = await as(t, "cat").query(
      api.social.getHouseholdLinkInvite.getHouseholdLinkInvite,
      { token },
    );
    expect(landing.state).toBe("invalid");
    await expectConvexCode(revokeLink(t, "ann", link.linkId), "InviteNotFound");
  });
});
