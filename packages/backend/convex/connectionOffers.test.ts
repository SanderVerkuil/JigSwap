import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { offerConnection } from "./social/connectionOffers";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Who = "alice" | "newbie" | "carol";

// Confirm-first connections: an invite link redeemed at sign-up only OFFERS the new member a
// mutual follow with the inviter; acceptConnection creates it, declineConnection is silent.

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (who: Who, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice", "Alice");
    const newbie = await mkUser("newbie", "Newbie");
    const carol = await mkUser("carol", "Carol");
    // Alice's profile is PRIVATE: the offer must still name her to the person she invited.
    await ctx.db.insert("profiles", {
      aggregateId: "profile-alice",
      memberId: alice,
      displayName: "Alice",
      visibility: "private",
      updatedAt: now,
    });
    return { alice, newbie, carol };
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

const expectUnavailable = async (p: Promise<unknown>) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe("ConnectionOfferUnavailable");
  });
};

// Alice's network link redeemed by the brand-new member: returns the link and the offer id.
const redeemAliceLink = async (t: T) => {
  const { token } = await as(t, "alice").mutation(
    api.social.getMyInviteLink.getMyInviteLink,
    {},
  );
  await as(t, "newbie").mutation(api.social.redeemInvite.redeemInvite, {
    token,
  });
  const offers = await as(t, "newbie").query(
    api.social.listMyConnectionOffers.listMyConnectionOffers,
    {},
  );
  expect(offers).toHaveLength(1);
  return { token, offerId: offers[0].offerId };
};

const offerRow = (t: T, offerId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("connectionOffers")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", offerId))
      .unique(),
  );

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

const notificationTypes = (t: T, userId: Id<"users">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).map((n) => n.type),
  );

const accept = (t: T, who: Who, offerId: string) =>
  as(t, who).mutation(api.social.acceptConnection.acceptConnection, {
    offerId,
  });
const decline = (t: T, who: Who, offerId: string) =>
  as(t, who).mutation(api.social.declineConnection.declineConnection, {
    offerId,
  });
const listFor = (t: T, who: Who) =>
  as(t, who).query(
    api.social.listMyConnectionOffers.listMyConnectionOffers,
    {},
  );

describe("the offer", () => {
  test("notifies only the new member, naming the private inviter, deep-linking to /people", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    await redeemAliceLink(t);
    await flushScheduled(t);

    expect(await notificationTypes(t, newbie)).toEqual([
      "connection_offer_received",
    ]);
    // The inviter learns nothing until the offer is accepted.
    expect(await notificationTypes(t, alice)).toEqual([]);

    const views = await as(t, "newbie").query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(views.page).toHaveLength(1);
    expect(views.page[0].href).toBe("/people");
    expect(views.page[0].actors[0]).toMatchObject({
      anonymous: false,
      name: "Alice",
    });
  });

  test("lists the open offer with the inviter revealed, for the recipient only", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const { offerId } = await redeemAliceLink(t);

    const offers = await listFor(t, "newbie");
    expect(offers).toEqual([
      {
        offerId,
        from: {
          anonymous: false,
          member: expect.objectContaining({ _id: alice, name: "Alice" }),
        },
        source: "inviteLink",
        createdAt: expect.any(Number),
      },
    ]);
    expect(await listFor(t, "alice")).toEqual([]);
    expect(await listFor(t, "carol")).toEqual([]);
  });

  test("one pending offer per ordered pair", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token, offerId } = await redeemAliceLink(t);
    const link = await linkFor(t, token);

    const again = await t.run((ctx) =>
      offerConnection(ctx, {
        fromId: alice,
        toId: newbie,
        source: "inviteLink",
        inviteLinkId: link!._id,
      }),
    );
    expect(again).toBe("pending");
    const rows = await t.run((ctx) =>
      ctx.db.query("connectionOffers").collect(),
    );
    expect(rows.map((r) => r.aggregateId)).toEqual([offerId]);
  });

  test("a lapsed pending offer is expired when a new one is made for the pair", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token, offerId } = await redeemAliceLink(t);
    const link = await linkFor(t, token);
    const row = await offerRow(t, offerId);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));

    await t.run((ctx) =>
      offerConnection(ctx, {
        fromId: alice,
        toId: newbie,
        source: "inviteLink",
        inviteLinkId: link!._id,
      }),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("connectionOffers").collect(),
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["expired", "pending"]);
  });

  test("is not made while either side is inside a decline cooldown", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const declinedAt = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: alice,
        targetId: newbie,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      }),
    );
    const { token } = await as(t, "alice").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    expect(
      await as(t, "newbie").mutation(api.social.redeemInvite.redeemInvite, {
        token,
      }),
    ).toEqual({ redeemed: true, inviterId: alice, connection: "skipped" });
    expect(await listFor(t, "newbie")).toEqual([]);
  });
});

describe("acceptConnection", () => {
  test("creates the mutual follow, bumps followsEstablished and only then tells the inviter", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token, offerId } = await redeemAliceLink(t);

    expect(await accept(t, "newbie", offerId)).toEqual({ connected: true });

    expect(await mutualEdges(t, alice, newbie)).toEqual({ ab: true, ba: true });
    expect((await linkFor(t, token))?.followsEstablished).toBe(1);
    const row = await offerRow(t, offerId);
    expect(row?.status).toBe("accepted");
    expect(row?.respondedAt).toBeDefined();
    expect(await listFor(t, "newbie")).toEqual([]);

    await flushScheduled(t);
    expect(await notificationTypes(t, alice)).toEqual(["new_follower"]);
  });

  test("cannot be answered twice", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { token, offerId } = await redeemAliceLink(t);
    await accept(t, "newbie", offerId);

    await expectUnavailable(accept(t, "newbie", offerId));
    await expectUnavailable(decline(t, "newbie", offerId));
    expect((await linkFor(t, token))?.followsEstablished).toBe(1);
  });

  test("a decline cooldown that started after the offer still blocks the follow", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token, offerId } = await redeemAliceLink(t);
    const declinedAt = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: newbie,
        targetId: alice,
        status: "declined",
        createdAt: declinedAt,
        respondedAt: declinedAt,
      }),
    );

    expect(await accept(t, "newbie", offerId)).toEqual({ connected: false });
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
    expect((await linkFor(t, token))?.followsEstablished).toBe(0);
  });

  test("a deactivated inviter's offer is hidden and cannot be accepted", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { offerId } = await redeemAliceLink(t);
    await t.run((ctx) => ctx.db.patch(alice, { isActive: false }));

    expect(await listFor(t, "newbie")).toEqual([]);
    await expectUnavailable(accept(t, "newbie", offerId));
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
  });
});

describe("declineConnection", () => {
  test("creates nothing and tells the inviter nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token, offerId } = await redeemAliceLink(t);

    await decline(t, "newbie", offerId);
    await flushScheduled(t);

    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
    expect((await offerRow(t, offerId))?.status).toBe("declined");
    expect(await listFor(t, "newbie")).toEqual([]);
    expect(await notificationTypes(t, alice)).toEqual([]);
    expect((await linkFor(t, token))?.followsEstablished).toBe(0);
    await expectUnavailable(accept(t, "newbie", offerId));
  });
});

describe("recipient only", () => {
  test("the inviter, a stranger and an unknown id all get the same generic error", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { offerId } = await redeemAliceLink(t);

    for (const who of ["alice", "carol"] as const) {
      await expectUnavailable(accept(t, who, offerId));
      await expectUnavailable(decline(t, who, offerId));
    }
    await expectUnavailable(accept(t, "newbie", "no-such-offer"));
    await expectUnavailable(decline(t, "newbie", "no-such-offer"));

    expect((await offerRow(t, offerId))?.status).toBe("pending");
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
  });

  test("unauthenticated callers are rejected", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { offerId } = await redeemAliceLink(t);
    await expect(
      t.mutation(api.social.acceptConnection.acceptConnection, { offerId }),
    ).rejects.toThrow();
    await expect(
      t.query(api.social.listMyConnectionOffers.listMyConnectionOffers, {}),
    ).rejects.toThrow();
  });
});

describe("expiry", () => {
  test("lazy: a pending offer past expiresAt is no longer listed or answerable", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { offerId } = await redeemAliceLink(t);
    const row = await offerRow(t, offerId);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));

    expect(await listFor(t, "newbie")).toEqual([]);
    await expectUnavailable(accept(t, "newbie", offerId));
    await expectUnavailable(decline(t, "newbie", offerId));
    expect(await mutualEdges(t, alice, newbie)).toEqual({
      ab: false,
      ba: false,
    });
  });

  test("scheduled: the expire job marks a due offer expired and leaves others alone", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { offerId } = await redeemAliceLink(t);
    const expire = () =>
      t.mutation(internal.social.connectionOffers.expireConnectionOffer, {
        offerId,
      });

    // Not due yet: stays pending.
    await expire();
    expect((await offerRow(t, offerId))?.status).toBe("pending");

    const row = await offerRow(t, offerId);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));
    await expire();
    expect((await offerRow(t, offerId))?.status).toBe("expired");

    // Unknown ids are a no-op.
    await t.mutation(internal.social.connectionOffers.expireConnectionOffer, {
      offerId: "gone",
    });
  });

  test("scheduled: an answered offer is never expired", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { offerId } = await redeemAliceLink(t);
    await accept(t, "newbie", offerId);
    const row = await offerRow(t, offerId);
    await t.run((ctx) => ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 }));

    await t.mutation(internal.social.connectionOffers.expireConnectionOffer, {
      offerId,
    });
    expect((await offerRow(t, offerId))?.status).toBe("accepted");
  });
});

describe("QR scan (unchanged)", () => {
  test("acceptQrFollow still creates the mutual follow at once, with no offer", async () => {
    const t = convexTest(schema, modules);
    const { alice, newbie } = await seed(t);
    const { token } = await as(t, "alice").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );

    expect(
      await as(t, "newbie").mutation(api.social.acceptQrFollow.acceptQrFollow, {
        token,
      }),
    ).toEqual({ established: true });
    expect(await mutualEdges(t, alice, newbie)).toEqual({ ab: true, ba: true });
    expect(
      await t.run((ctx) => ctx.db.query("connectionOffers").collect()),
    ).toEqual([]);
  });
});
