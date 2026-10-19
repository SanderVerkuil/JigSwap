import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Household-context invite links (quick start Q6, spec §3.4): admin-only minting, single use,
// 14-day expiry, 5 open / 10 per 24h per inviter, and a PENDING household invite on redeem by a
// brand-new member (never an auto-join). The plain network link keeps its old behaviour.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat" | "newbie" | "newbie2";

const DAY_MS = 24 * 60 * 60 * 1000;

const seed = (t: T) =>
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
      newbie: await mkUser("clerk_newbie", "Newbie"),
      newbie2: await mkUser("clerk_newbie2", "Newbie Two"),
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

// Ann founds a household (she is its admin).
const annCreatesHousehold = (t: T) =>
  as(t, "ann").mutation(api.household.createHousehold.createHousehold, {});

const mintAsAnn = (t: T) =>
  as(t, "ann").mutation(
    api.social.createHouseholdInviteLink.createHouseholdInviteLink,
    {},
  );

const redeem = (t: T, who: Who, token: string) =>
  as(t, who).mutation(api.social.redeemInvite.redeemInvite, { token });

const linkFor = (t: T, token: string) =>
  t.run((ctx) =>
    ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
  );

const mutualEdges = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    const edge = (follower: Id<"users">, followee: Id<"users">) =>
      ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", follower).eq("followeeId", followee),
        )
        .unique();
    return {
      ab: (await edge(a, b)) !== null,
      ba: (await edge(b, a)) !== null,
    };
  });

const pendingOffersTo = (t: T, toId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("connectionOffers")
      .withIndex("by_to_status", (q) =>
        q.eq("toId", toId).eq("status", "pending"),
      )
      .collect(),
  );

const householdInvitesFor = (t: T, invitee: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("householdInvites")
      .withIndex("by_invitee_status", (q) => q.eq("inviteeId", invitee))
      .collect(),
  );

const makeOld = (t: T, who: Id<"users">) =>
  t.run((ctx) => ctx.db.patch(who, { createdAt: Date.now() - 16 * 60 * 1000 }));

describe("createHouseholdInviteLink", () => {
  test("the household admin mints a single-use link that expires in 14 days", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    const householdId = await annCreatesHousehold(t);

    const before = Date.now();
    const { token, expiresAt } = await mintAsAnn(t);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 14 * DAY_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 14 * DAY_MS);

    const row = await linkFor(t, token);
    expect(row?.ownerId).toBe(ann);
    expect(row?.context).toEqual({ kind: "household", householdId });
    expect(row?.expiresAt).toBe(expiresAt);
    expect(row?.consumedAt).toBeUndefined();
  });

  test("each call mints a fresh token", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const a = await mintAsAnn(t);
    const b = await mintAsAnn(t);
    expect(a.token).not.toBe(b.token);
  });

  test("a plain household member (not the admin) is rejected", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await annCreatesHousehold(t);
    const inviteId = await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: bob },
    );
    await as(t, "bob").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );

    await expectConvexCode(
      as(t, "bob").mutation(
        api.social.createHouseholdInviteLink.createHouseholdInviteLink,
        {},
      ),
      "NotHouseholdAdmin",
    );
  });

  test("a member in no household is rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectConvexCode(
      as(t, "cat").mutation(
        api.social.createHouseholdInviteLink.createHouseholdInviteLink,
        {},
      ),
      "NotInHousehold",
    );
  });

  test("unauthenticated callers are rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    await expect(
      t.mutation(
        api.social.createHouseholdInviteLink.createHouseholdInviteLink,
        {},
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(
        api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
        {},
      ),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("it takes no recipient: an email argument is refused by the validator", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    await expect(
      as(t, "ann").mutation(
        api.social.createHouseholdInviteLink.createHouseholdInviteLink,
        // @ts-expect-error -- the function deliberately has no recipient argument
        { email: "friend@example.com" },
      ),
    ).rejects.toThrow();
  });
});

describe("rate limits", () => {
  test("at most 5 open household links per inviter", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    for (let i = 0; i < 5; i++) await mintAsAnn(t);

    await expectConvexCode(mintAsAnn(t), "invite_rate_limited");
  });

  test("consumed, expired and revoked links no longer count as open", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const tokens: string[] = [];
    for (let i = 0; i < 5; i++) tokens.push((await mintAsAnn(t)).token);

    // One consumed (redeemed by a new member), one expired.
    await redeem(t, "newbie", tokens[0]);
    const expired = await linkFor(t, tokens[1]);
    await t.run((ctx) =>
      ctx.db.patch(expired!._id, { expiresAt: Date.now() - 1 }),
    );
    await mintAsAnn(t);
    await mintAsAnn(t);
    await expectConvexCode(mintAsAnn(t), "invite_rate_limited");

    // Revoking the open ones frees the open budget again.
    const { revoked } = await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );
    expect(revoked).toBe(5);
    await mintAsAnn(t);
  });

  test("at most 10 created per rolling 24 hours, even when none are open", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    for (let i = 0; i < 5; i++) await mintAsAnn(t);
    await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );
    for (let i = 0; i < 5; i++) await mintAsAnn(t);
    await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );

    await expectConvexCode(mintAsAnn(t), "invite_rate_limited");

    // Once the earlier links fall outside the 24h window, minting works again.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("inviteLinks").collect();
      for (const row of rows) {
        await ctx.db.patch(row._id, { createdAt: Date.now() - DAY_MS - 1 });
      }
    });
    await mintAsAnn(t);
  });

  test("the network link does not count toward the household limits", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    for (let i = 0; i < 6; i++) {
      await as(t, "ann").mutation(
        api.social.resetInviteLink.resetInviteLink,
        {},
      );
    }
    for (let i = 0; i < 5; i++) await mintAsAnn(t);
    await expectConvexCode(mintAsAnn(t), "invite_rate_limited");
  });

  test("revokeHouseholdInviteLinks only touches the actor's own household links", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token: household } = await mintAsAnn(t);
    const { token: network } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    // Bob (no household links) revokes nothing of Ann's.
    expect(
      await as(t, "bob").mutation(
        api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
        {},
      ),
    ).toEqual({ revoked: 0 });
    expect((await linkFor(t, household))?.revokedAt).toBeUndefined();

    expect(
      await as(t, "ann").mutation(
        api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
        {},
      ),
    ).toEqual({ revoked: 1 });
    expect((await linkFor(t, household))?.revokedAt).toBeDefined();
    expect((await linkFor(t, network))?.revokedAt).toBeUndefined();
  });
});

describe("redeeming a household link", () => {
  test("a new member gets a PENDING invite (not joined), a connection offer (no follow) and the attribution", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    const householdId = await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);

    const result = await redeem(t, "newbie", token);
    expect(result).toEqual({
      redeemed: true,
      inviterId: ann,
      connection: "pending",
      householdInvite: "pending",
    });

    // Not joined: no household for the newcomer, one pending invite from Ann.
    expect(
      await as(t, "newbie").query(
        api.household.getMyHousehold.getMyHousehold,
        {},
      ),
    ).toBeNull();
    const incoming = await as(t, "newbie").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );
    expect(incoming).toHaveLength(1);
    expect(incoming[0].inviter.name).toBe("Ann");
    const invites = await householdInvitesFor(t, newbie);
    expect(invites.map((i) => [i.householdId, i.status])).toEqual([
      [householdId, "pending"],
    ]);

    // The existing in-app notification reaches the invitee.
    await flushScheduled(t);
    const types = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", newbie))
          .collect()
      ).map((n) => n.type),
    );
    expect(types).toContain("household_invite_received");
    expect(types).toContain("connection_offer_received");

    // Attribution is kept and the link is consumed by the newcomer, but nobody follows anyone:
    // the newcomer is offered the connection with Ann (source householdLink) and confirms first.
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: false, ba: false });
    const offers = await pendingOffersTo(t, newbie);
    expect(offers.map((o) => [o.fromId, o.source])).toEqual([
      [ann, "householdLink"],
    ]);
    const link = await linkFor(t, token);
    expect(offers[0].inviteLinkId).toBe(link?._id);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.followsEstablished).toBe(0);
    expect(link?.consumedBy).toBe(newbie);
    expect(link?.consumedAt).toBeDefined();
  });

  test("the offer and the household invite are separate answers: following each other does not join the household", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    const householdId = await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await redeem(t, "newbie", token);

    // Both are pending, and nobody follows anybody yet.
    const [offer] = await as(t, "newbie").query(
      api.social.listMyConnectionOffers.listMyConnectionOffers,
      {},
    );
    expect(offer.source).toBe("householdLink");
    expect(offer.from.memberId).toBe(ann);
    expect(
      (await householdInvitesFor(t, newbie)).map((i) => [
        i.householdId,
        i.status,
      ]),
    ).toEqual([[householdId, "pending"]]);
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: false, ba: false });

    // Accepting the offer follows each other; the household invite is still undecided.
    await as(t, "newbie").mutation(
      api.social.acceptConnection.acceptConnection,
      { offerId: offer.offerId },
    );
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: true, ba: true });
    expect((await householdInvitesFor(t, newbie)).map((i) => i.status)).toEqual(
      ["pending"],
    );
    expect(
      await as(t, "newbie").query(
        api.household.getMyHousehold.getMyHousehold,
        {},
      ),
    ).toBeNull();
    expect((await linkFor(t, token))?.followsEstablished).toBe(1);
  });

  test("the invitee can accept and join", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await redeem(t, "newbie", token);
    const [invite] = await as(t, "newbie").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );

    await as(t, "newbie").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId: invite.inviteId },
    );
    const mine = await as(t, "newbie").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(mine?.viewerRole).toBe("member");
    expect(mine?.members.map((m) => m.name).sort()).toEqual(["Ann", "Newbie"]);
  });

  test("the invitee can decline and stays out", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await redeem(t, "newbie", token);
    const [invite] = await as(t, "newbie").query(
      api.household.listMyHouseholdInvites.listMyHouseholdInvites,
      {},
    );

    await as(t, "newbie").mutation(
      api.household.declineHouseholdInvite.declineHouseholdInvite,
      { inviteId: invite.inviteId },
    );
    expect(
      await as(t, "newbie").query(
        api.household.getMyHousehold.getMyHousehold,
        {},
      ),
    ).toBeNull();
    const annView = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(annView?.members.map((m) => m.name)).toEqual(["Ann"]);
  });

  test("an existing member gets no invite and no follow, and the link stays usable", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await makeOld(t, cat);

    expect(await redeem(t, "cat", token)).toEqual({ redeemed: false });
    expect(await householdInvitesFor(t, cat)).toEqual([]);
    expect(await mutualEdges(t, ann, cat)).toEqual({ ab: false, ba: false });
    expect(await pendingOffersTo(t, cat)).toEqual([]);
    const link = await linkFor(t, token);
    expect(link?.consumedAt).toBeUndefined();
    expect(link?.signupsAttributed).toBe(0);
  });

  test("single use: a second new member gets nothing", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie2 } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await redeem(t, "newbie", token);

    expect(await redeem(t, "newbie2", token)).toEqual({ redeemed: false });
    expect(await householdInvitesFor(t, newbie2)).toEqual([]);
    expect(await mutualEdges(t, ann, newbie2)).toEqual({
      ab: false,
      ba: false,
    });
    expect(await pendingOffersTo(t, newbie2)).toEqual([]);
    const ledger = await t.run((ctx) =>
      ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", newbie2))
        .unique(),
    );
    expect(ledger).toBeNull();
    expect((await linkFor(t, token))?.signupsAttributed).toBe(1);
  });

  test("an expired link is invalid as a whole: no ledger row, no offer, no follow, no invite", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    const row = await linkFor(t, token);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));

    expect(await redeem(t, "newbie", token)).toEqual({ redeemed: false });
    expect(await householdInvitesFor(t, newbie)).toEqual([]);
    expect(await pendingOffersTo(t, newbie)).toEqual([]);
    expect(await mutualEdges(t, ann, newbie)).toEqual({
      ab: false,
      ba: false,
    });
    const ledger = await t.run((ctx) =>
      ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", newbie))
        .unique(),
    );
    expect(ledger).toBeNull();
  });

  test("a revoked household link is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { newbie } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );
    expect(await redeem(t, "newbie", token)).toEqual({ redeemed: false });
    expect(await householdInvitesFor(t, newbie)).toEqual([]);
  });

  test("an inviter who is no longer the admin: invite skipped, offer and attribution kept", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    // Ann leaves (the household dissolves), then founds a NEW household: the link must not
    // invite into the new one, because it was minted for the old household.
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    await annCreatesHousehold(t);

    const result = await redeem(t, "newbie", token);
    expect(result).toEqual({
      redeemed: true,
      inviterId: ann,
      connection: "pending",
      householdInvite: "skipped",
    });
    expect(await householdInvitesFor(t, newbie)).toEqual([]);
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: false, ba: false });
    expect(await pendingOffersTo(t, newbie)).toHaveLength(1);
    expect((await linkFor(t, token))?.consumedBy).toBe(newbie);
  });

  test("a new member who already founded a household still gets the pending invite", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await as(t, "newbie").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );

    const result = await redeem(t, "newbie", token);
    expect(result).toEqual({
      redeemed: true,
      inviterId: ann,
      connection: "pending",
      householdInvite: "pending",
    });
    // They choose on accept whether to leave their own household.
    expect(await householdInvitesFor(t, newbie)).toHaveLength(1);
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: false, ba: false });
    expect(await pendingOffersTo(t, newbie)).toHaveLength(1);
  });

  test("no email address is stored anywhere along the way", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await redeem(t, "newbie", token);
    await flushScheduled(t);

    const stored = await t.run(async (ctx) => ({
      inviteLinks: await ctx.db.query("inviteLinks").collect(),
      inviteRedemptions: await ctx.db.query("inviteRedemptions").collect(),
      householdInvites: await ctx.db.query("householdInvites").collect(),
      notifications: await ctx.db.query("notifications").collect(),
    }));
    expect(stored.inviteLinks).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toMatch(/@/);
  });
});

describe("plain network link", () => {
  test("keeps attribution, offers a connection (no follow) and reports no household invite", async () => {
    const t = convexTest(schema, modules);
    const { ann, newbie } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    expect(await redeem(t, "newbie", token)).toEqual({
      redeemed: true,
      inviterId: ann,
      connection: "pending",
    });
    expect(await mutualEdges(t, ann, newbie)).toEqual({ ab: false, ba: false });
    expect(
      (await pendingOffersTo(t, newbie)).map((o) => [o.fromId, o.source]),
    ).toEqual([[ann, "inviteLink"]]);
    expect(await householdInvitesFor(t, newbie)).toEqual([]);
    const link = await linkFor(t, token);
    expect(link?.signupsAttributed).toBe(1);
    expect(link?.consumedAt).toBeUndefined();
  });

  test("getMyInviteLink and resetInviteLink ignore household links", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    // A household link minted BEFORE the network link must not be returned as "the" link.
    const { token: household } = await mintAsAnn(t);
    const { token: network } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(network).not.toBe(household);
    expect(
      (
        await as(t, "ann").mutation(
          api.social.getMyInviteLink.getMyInviteLink,
          {},
        )
      ).token,
    ).toBe(network);

    const { token: reset } = await as(t, "ann").mutation(
      api.social.resetInviteLink.resetInviteLink,
      {},
    );
    expect(reset).not.toBe(network);
    expect((await linkFor(t, network))?.revokedAt).toBeDefined();
    expect((await linkFor(t, household))?.revokedAt).toBeUndefined();
  });
});

describe("other token readers", () => {
  test("acceptQrFollow ignores household links", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);

    expect(
      await as(t, "cat").mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: false });
    expect(await mutualEdges(t, ann, cat)).toEqual({ ab: false, ba: false });
  });

  test("getInviteContext reports the kind, and expiry or use makes a household link invalid", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    await annCreatesHousehold(t);
    const { token: network } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const { token: household } = await mintAsAnn(t);
    const { token: toExpire } = await mintAsAnn(t);

    const ctxOf = (token: string, memberId: Id<"users">) =>
      t.query(api.social.getInviteContext.getInviteContext, {
        token,
        memberId,
      });

    expect(await ctxOf(network, ann)).toEqual({
      valid: true,
      kind: "network",
    });
    expect(await ctxOf(household, ann)).toEqual({
      valid: true,
      kind: "household",
    });
    // Pinned to the viewed profile: no kind leaks through someone else's page.
    expect(await ctxOf(household, bob)).toEqual({
      valid: false,
      kind: "network",
    });

    await redeem(t, "newbie", household);
    expect(await ctxOf(household, ann)).toEqual({
      valid: false,
      kind: "household",
    });

    const row = await linkFor(t, toExpire);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));
    expect(await ctxOf(toExpire, ann)).toEqual({
      valid: false,
      kind: "household",
    });
  });
});

// An EXISTING member opening a household link (spec addendum to §3.4): the landing shows
// "<inviter> invited you to their household" with Accept / Decline. Accept joins through the same
// domain path as accepting a pending invite and consumes the token; Decline consumes it too.
describe("existing member on a household link", () => {
  const landing = (t: T, who: Who, token: string) =>
    as(t, who).query(api.social.getHouseholdLinkInvite.getHouseholdLinkInvite, {
      token,
    });
  const acceptLink = (t: T, who: Who, token: string) =>
    as(t, who).mutation(
      api.social.acceptHouseholdLinkInvite.acceptHouseholdLinkInvite,
      { token },
    );
  const declineLink = (t: T, who: Who, token: string) =>
    as(t, who).mutation(
      api.social.declineHouseholdLinkInvite.declineHouseholdLinkInvite,
      { token },
    );
  const notificationTypes = (t: T, user: Id<"users">) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", user))
          .collect()
      ).map((n) => n.type),
    );

  test("the landing names the inviter and offers Accept", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await makeOld(t, cat);

    expect(await landing(t, "cat", token)).toEqual({
      state: "can-accept",
      inviterName: "Ann",
    });
  });

  test("accepting joins the household, consumes the token, notifies the admin and follows nobody", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    const householdId = await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await makeOld(t, cat);

    expect(await acceptLink(t, "cat", token)).toBe(householdId);

    const mine = await as(t, "cat").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(mine?.viewerRole).toBe("member");
    expect(mine?.members.map((m) => m.name).sort()).toEqual(["Ann", "Cat"]);
    expect(
      (await householdInvitesFor(t, cat)).map((i) => [
        i.householdId,
        i.inviterId,
        i.status,
      ]),
    ).toEqual([[householdId, ann, "accepted"]]);

    const link = await linkFor(t, token);
    expect(link?.consumedBy).toBe(cat);
    expect(link?.consumedAt).toBeDefined();
    expect(link?.signupsAttributed).toBe(0);

    await flushScheduled(t);
    expect(await notificationTypes(t, ann)).toContain(
      "household_invite_accepted",
    );
    // The invitee answered at once: no stale "you were invited" notification.
    expect(await notificationTypes(t, cat)).not.toContain(
      "household_invite_received",
    );
    expect(await mutualEdges(t, ann, cat)).toEqual({ ab: false, ba: false });
    expect(
      await t.run((ctx) => ctx.db.query("inviteRedemptions").collect()),
    ).toEqual([]);
  });

  test("accepting also answers an in-app invite already pending from that household", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    const householdId = await annCreatesHousehold(t);
    await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: cat },
    );
    const { token } = await mintAsAnn(t);

    expect(await acceptLink(t, "cat", token)).toBe(householdId);
    expect((await householdInvitesFor(t, cat)).map((i) => i.status)).toEqual([
      "accepted",
    ]);
  });

  test("a member already in a household is told why and cannot accept without leaving it", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await as(t, "cat").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );

    expect(await landing(t, "cat", token)).toEqual({
      state: "already-in-household",
      inviterName: "Ann",
    });
    await expectConvexCode(acceptLink(t, "cat", token), "AlreadyInHousehold");
    expect((await linkFor(t, token))?.consumedAt).toBeUndefined();
    expect(await householdInvitesFor(t, cat)).toEqual([]);
  });

  test("a member already in a household leaves it and joins in one step", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await as(t, "cat").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );

    await as(t, "cat").mutation(
      api.social.acceptHouseholdLinkInvite.acceptHouseholdLinkInvite,
      { token, leaveCurrentHousehold: true },
    );
    const memberships = await t.run((ctx) =>
      ctx.db.query("householdMembers").collect(),
    );
    // Cat's own household (she was its only member) is gone; she is in Ann's.
    expect(memberships.filter((m) => m.memberId === cat)).toHaveLength(1);
    expect(memberships.find((m) => m.memberId === cat)?.householdId).toBe(
      memberships.find((m) => m.memberId === ann)?.householdId,
    );
    expect(
      await t.run((ctx) => ctx.db.query("households").collect()),
    ).toHaveLength(1);
    expect((await linkFor(t, token))?.consumedBy).toBe(cat);
  });

  test("a member already in a household can decline the link", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await as(t, "cat").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    await declineLink(t, "cat", token);
    expect((await linkFor(t, token))?.consumedBy).toBe(cat);
    expect(await landing(t, "cat", token)).toEqual({
      state: "used",
      joinRequest: { status: "none" },
    });
  });

  test("an expired link is reported and refused", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("inviteLinks")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });

    expect(await landing(t, "cat", token)).toEqual({
      state: "expired",
      joinRequest: { status: "none" },
    });
    await expectConvexCode(acceptLink(t, "cat", token), "InviteLinkExpired");
    await expectConvexCode(declineLink(t, "cat", token), "InviteLinkExpired");
  });

  test("a used link is reported and refused", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);
    await acceptLink(t, "cat", token);

    expect(await landing(t, "bob", token)).toEqual({
      state: "used",
      joinRequest: { status: "none" },
    });
    await expectConvexCode(acceptLink(t, "bob", token), "InviteLinkUsed");
    expect(await householdInvitesFor(t, bob)).toEqual([]);
  });

  test("unknown, revoked and dead-household tokens are invalid", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token: revoked } = await mintAsAnn(t);
    await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );
    const { token: stale } = await mintAsAnn(t);
    // Ann leaves (the household dissolves) and founds a new one: the old link outlives neither.
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    await annCreatesHousehold(t);

    for (const token of ["nope", revoked, stale]) {
      expect(await landing(t, "cat", token)).toEqual({ state: "invalid" });
      await expectConvexCode(acceptLink(t, "cat", token), "InviteLinkInvalid");
      await expectConvexCode(declineLink(t, "cat", token), "InviteLinkInvalid");
    }
  });

  test("the inviter cannot accept or decline their own link", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);

    expect(await landing(t, "ann", token)).toEqual({ state: "own-link" });
    await expectConvexCode(acceptLink(t, "ann", token), "OwnInviteLink");
    await expectConvexCode(declineLink(t, "ann", token), "OwnInviteLink");
    expect((await linkFor(t, token))?.consumedAt).toBeUndefined();
  });

  test("declining consumes the link silently, so it cannot be accepted later", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);

    expect(await declineLink(t, "cat", token)).toBeNull();
    const link = await linkFor(t, token);
    expect(link?.consumedBy).toBe(cat);
    expect(link?.consumedAt).toBeDefined();
    expect(
      await as(t, "cat").query(api.household.getMyHousehold.getMyHousehold, {}),
    ).toBeNull();
    expect(await householdInvitesFor(t, cat)).toEqual([]);

    await flushScheduled(t);
    expect(await notificationTypes(t, ann)).toEqual([]);
    expect(await landing(t, "cat", token)).toEqual({
      state: "used",
      joinRequest: { status: "none" },
    });
    await expectConvexCode(acceptLink(t, "cat", token), "InviteLinkUsed");
  });

  test("a plain network link is unaffected", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annCreatesHousehold(t);
    const { token } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    expect(await landing(t, "cat", token)).toEqual({ state: "invalid" });
    await expectConvexCode(acceptLink(t, "cat", token), "InviteLinkInvalid");
    await expectConvexCode(declineLink(t, "cat", token), "InviteLinkInvalid");
    const link = await linkFor(t, token);
    expect(link?.consumedAt).toBeUndefined();
    expect(link?.revokedAt).toBeUndefined();
    expect(await householdInvitesFor(t, cat)).toEqual([]);
    // The network link still does its own job.
    expect(
      await as(t, "cat").mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: true });
    expect(await mutualEdges(t, ann, cat)).toEqual({ ab: true, ba: true });
  });

  test("unauthenticated callers are rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await annCreatesHousehold(t);
    const { token } = await mintAsAnn(t);

    await expect(
      t.query(api.social.getHouseholdLinkInvite.getHouseholdLinkInvite, {
        token,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(
        api.social.acceptHouseholdLinkInvite.acceptHouseholdLinkInvite,
        { token },
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(
        api.social.declineHouseholdLinkInvite.declineHouseholdLinkInvite,
        { token },
      ),
    ).rejects.toThrow(/Unauthenticated/);
    expect((await linkFor(t, token))?.consumedAt).toBeUndefined();
  });
});
