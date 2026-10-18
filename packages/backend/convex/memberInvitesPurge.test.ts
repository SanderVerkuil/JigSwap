import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  makeFakeInvitationGateway,
  type FakeInvitationGateway,
} from "./invitations/adapters/fakeInvitationGateway";
import schema from "./schema";

// Account deletion for circle invites and connection offers: users.deleteUser schedules
// conversation/purgeMemberMessagingData, which deletes every circle invite the member sent or
// received and every connection offer they made or were made, of any status, together with the
// notifications that point at them. The other party is left with nothing to open: no invite or
// offer listed, no notification for it, and no email or push still to come.
// The email invitations they sent go too, with their Clerk invitations revoked.

// Email invitations' Clerk revokes go to the in-memory fake, never to Clerk.
const gate = vi.hoisted(() => ({
  gateway: null as FakeInvitationGateway | null,
}));
vi.mock("./invitations/adapters/invitationGateway", async (orig) => ({
  ...(await orig<typeof import("./invitations/adapters/invitationGateway")>()),
  makeInvitationGatewayFromEnv: () => gate.gateway,
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "newbie";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const settleDueJobs = async (t: T) => {
  for (let i = 0; i < 200; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy = jobs.some(
      (job) =>
        job.state.kind === "inProgress" ||
        (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
    );
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

const mutualFollow = (t: T, a: Id<"users">, b: Id<"users">) =>
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

// Alice is the member who deletes her account.
//   sent invite      Alice, an Admin of Bob's circle, invites Carol.
//   received invite  Carol invites Alice to her own circle.
//   sent offer       Newbie signs up through Alice's invite link.
//   received offer   Alice signed up through Bob's invite link.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mk("alice"),
      bob: await mk("bob"),
      carol: await mk("carol"),
      newbie: await mk("newbie"),
    };
  });
  await mutualFollow(t, ids.alice, ids.carol);

  const bobCircle = (await as(t, "bob").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Bob's table" },
  )) as string;
  await as(t, "bob").mutation(internal.sharing.addMember.addMember, {
    circleId: bobCircle,
    memberId: ids.alice,
    permission: "Admin",
  });
  const carolCircle = (await as(t, "carol").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Carol's corner" },
  )) as string;

  const sentInvite = await as(t, "alice").mutation(
    api.sharing.inviteToCircle.inviteToCircle,
    { circleId: bobCircle, inviteeId: ids.carol, permission: "Exchange" },
  );
  const receivedInvite = await as(t, "carol").mutation(
    api.sharing.inviteToCircle.inviteToCircle,
    { circleId: carolCircle, inviteeId: ids.alice, permission: "Exchange" },
  );

  const redeem = async (owner: Who, redeemer: Who) => {
    const { token } = await as(t, owner).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    await as(t, redeemer).mutation(api.social.redeemInvite.redeemInvite, {
      token,
    });
    const [offer] = await as(t, redeemer).query(
      api.social.listMyConnectionOffers.listMyConnectionOffers,
      {},
    );
    return offer.offerId;
  };
  const sentOffer = await redeem("alice", "newbie");
  const receivedOffer = await redeem("bob", "alice");
  await settleDueJobs(t);

  return {
    ...ids,
    bobCircle,
    carolCircle,
    sentInvite,
    receivedInvite,
    sentOffer,
    receivedOffer,
  };
};

type Seeded = Awaited<ReturnType<typeof seed>>;

const deleteAlice = async (t: T) => {
  await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
  await settleDueJobs(t);
};

const invitesOf = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("circleInvites").collect()).filter(
      (row) => row.inviterId === memberId || row.inviteeId === memberId,
    ),
  );

const offersOf = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("connectionOffers").collect()).filter(
      (row) => row.fromId === memberId || row.toId === memberId,
    ),
  );

// Every notification row (anyone's) pointing at one of these invite or offer ids.
const notificationsPointingAt = (t: T, ids: string[]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter((row) => {
      const subject = row.subject as Doc<"notifications">["subject"];
      if (subject?.kind === "circleInvite")
        return ids.includes(subject.inviteId);
      if (subject?.kind === "connectionOffer") {
        return ids.includes(subject.offerId);
      }
      return false;
    }),
  );

const viewTypes = async (t: T, who: Who) =>
  (
    await as(t, who).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 50, cursor: null } },
    )
  ).page.map((view) => view.type);

const circleInvitesFor = (t: T, who: Who) =>
  as(t, who).query(api.sharing.listMyCircleInvites.listMyCircleInvites, {});

const circleInvitesOf = (t: T, who: Who, circleId: string) =>
  as(t, who).query(api.sharing.listCircleInvites.listCircleInvites, {
    circleId,
  });

const offersFor = (t: T, who: Who) =>
  as(t, who).query(
    api.social.listMyConnectionOffers.listMyConnectionOffers,
    {},
  );

const allIds = (s: Seeded) => [
  s.sentInvite,
  s.receivedInvite,
  s.sentOffer,
  s.receivedOffer,
];

describe("account deletion: circle invites and connection offers", () => {
  test("the seed holds one invite and one offer each way, each notified", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(await invitesOf(t, s.alice)).toHaveLength(2);
    expect(await offersOf(t, s.alice)).toHaveLength(2);
    expect(
      (await notificationsPointingAt(t, allIds(s))).map((n) => [
        n.userId,
        n.type,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [s.carol, "circle_invite_received"],
        [s.alice, "circle_invite_received"],
        [s.newbie, "connection_offer_received"],
        [s.alice, "connection_offer_received"],
      ]),
    );
    // Before the deletion the other party sees each one.
    expect(await circleInvitesFor(t, "carol")).toHaveLength(1);
    expect(await circleInvitesOf(t, "bob", s.bobCircle)).toHaveLength(1);
    expect(await circleInvitesOf(t, "carol", s.carolCircle)).toHaveLength(1);
    expect(await offersFor(t, "newbie")).toHaveLength(1);
  });

  test("the circle invites she sent and received are deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await invitesOf(t, s.alice)).toEqual([]);
  });

  test("the connection offers she made and was made are deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await offersOf(t, s.alice)).toEqual([]);
  });

  test("decided invites and offers go too", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await as(t, "carol").mutation(
      api.sharing.declineCircleInvite.declineCircleInvite,
      { inviteId: s.sentInvite },
    );
    await as(t, "newbie").mutation(
      api.social.declineConnection.declineConnection,
      { offerId: s.sentOffer },
    );
    await deleteAlice(t);

    expect(await invitesOf(t, s.alice)).toEqual([]);
    expect(await offersOf(t, s.alice)).toEqual([]);
  });

  test("every notification pointing at them is deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await notificationsPointingAt(t, allIds(s))).toEqual([]);
  });

  test("the invitee of her invite has no invite and no notification left", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await deleteAlice(t);

    expect(await circleInvitesFor(t, "carol")).toEqual([]);
    expect(await viewTypes(t, "carol")).not.toContain("circle_invite_received");
  });

  test("circle Admins no longer see a pending invite from or to her", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await circleInvitesOf(t, "bob", s.bobCircle)).toEqual([]);
    expect(await circleInvitesOf(t, "carol", s.carolCircle)).toEqual([]);
  });

  test("the recipient of her offer has no offer and no notification left", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await deleteAlice(t);

    expect(await offersFor(t, "newbie")).toEqual([]);
    expect(await viewTypes(t, "newbie")).not.toContain(
      "connection_offer_received",
    );
  });

  test("an email or push still due for her offer is not sent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const deliver = () =>
      t.query(internal.notifications.resolveForDelivery.resolveForDelivery, {
        recipientId: s.newbie,
        type: "connection_offer_received",
        relatedId: s.sentOffer,
        actorId: s.alice,
        subject: { kind: "connectionOffer", offerId: s.sentOffer },
      });
    expect(await deliver()).not.toBeNull();

    await deleteAlice(t);

    expect(await deliver()).toBeNull();
  });

  test("other members' invites and offers are untouched", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await mutualFollow(t, s.bob, s.newbie);
    const bobToNewbie = await as(t, "bob").mutation(
      api.sharing.inviteToCircle.inviteToCircle,
      { circleId: s.bobCircle, inviteeId: s.newbie, permission: "ViewOnly" },
    );
    await settleDueJobs(t);
    await deleteAlice(t);

    expect(
      (await circleInvitesFor(t, "newbie")).map((invite) => invite.inviteId),
    ).toEqual([bobToNewbie]);
    expect(await viewTypes(t, "newbie")).toContain("circle_invite_received");
  });

  test("the purge runs in batches", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, batchSize: 1 },
    );
    await settleDueJobs(t);

    expect(await invitesOf(t, s.alice)).toEqual([]);
    expect(await offersOf(t, s.alice)).toEqual([]);
    expect(await notificationsPointingAt(t, allIds(s))).toEqual([]);
  });
});

describe("account deletion: email invitations", () => {
  // Alice sent two email invitations (one reached Clerk, one went to an existing member and never
  // did); Bob sent one of his own.
  const seedEmailInvites = (t: T, s: Seeded) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const row = (
        inviterId: Id<"users">,
        aggregateId: string,
        clerkInvitationId?: string,
      ) =>
        ctx.db.insert("emailInvites", {
          aggregateId,
          kind: "follow",
          inviterId,
          ...(clerkInvitationId !== undefined && { clerkInvitationId }),
          createdAt: now,
          expiresAt: now + 14 * 24 * 60 * 60_000,
        });
      await row(s.alice, "ref-alice-1", "inv_alice_1");
      await row(s.alice, "ref-alice-2");
      await row(s.bob, "ref-bob-1", "inv_bob_1");
    });

  const emailInviteRefs = (t: T) =>
    t.run(async (ctx) =>
      (await ctx.db.query("emailInvites").collect()).map(
        (row) => row.aggregateId,
      ),
    );

  beforeEach(() => {
    gate.gateway = makeFakeInvitationGateway();
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy_not_a_real_key");
  });

  test("her rows are deleted and their Clerk invitations revoked; Bob's stay", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedEmailInvites(t, s);

    await deleteAlice(t);

    expect(await emailInviteRefs(t)).toEqual(["ref-bob-1"]);
    expect(gate.gateway?.revoked).toEqual(["inv_alice_1"]);
    expect(gate.gateway?.deleted).toEqual(["inv_alice_1"]);
  });

  test("in batches too", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedEmailInvites(t, s);

    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, phase: "emailInvitesOut", batchSize: 1 },
    );
    await settleDueJobs(t);

    expect(await emailInviteRefs(t)).toEqual(["ref-bob-1"]);
    expect(gate.gateway?.revoked).toEqual(["inv_alice_1"]);
    expect(gate.gateway?.deleted).toEqual(["inv_alice_1"]);
  });

  test("the pending in-app invite an email invitation made is withdrawn", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("householdInvites", {
        aggregateId: "hh-invite-1",
        householdId: "hh_1",
        inviterId: s.alice,
        inviteeId: s.carol,
        status: "pending",
        createdAt: now,
        viaEmail: true,
      });
      await ctx.db.insert("emailInvites", {
        aggregateId: "ref-alice-hh",
        kind: "household",
        inviterId: s.alice,
        householdId: "hh_1",
        fallback: { householdInviteId: "hh-invite-1" },
        createdAt: now,
        expiresAt: now + 14 * 24 * 60 * 60_000,
      });
    });

    await deleteAlice(t);

    expect(
      await t.run((ctx) => ctx.db.query("householdInvites").collect()),
    ).toEqual([]);
  });

  test("her emailInvite rate-limit counter goes with the others", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `emailInvite:${s.alice}`,
        windowStart: Date.now(),
        count: 3,
      }),
    );

    await deleteAlice(t);

    expect(
      await t.run((ctx) =>
        ctx.db
          .query("rateLimits")
          .withIndex("by_key", (q) => q.eq("key", `emailInvite:${s.alice}`))
          .unique(),
      ),
    ).toBeNull();
  });
});

describe("account deletion: household invites", () => {
  test("every household invite she sent or received goes, with the invitee's notification; others stay", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const invite = (
        aggregateId: string,
        inviterId: Id<"users">,
        inviteeId: Id<"users">,
        status: "pending" | "accepted" | "declined",
      ) =>
        ctx.db.insert("householdInvites", {
          aggregateId,
          householdId: "hh_1",
          inviterId,
          inviteeId,
          status,
          createdAt: now,
        });
      await invite("hh-alice-carol", s.alice, s.carol, "pending");
      await invite("hh-alice-bob", s.alice, s.bob, "declined");
      await invite("hh-bob-alice", s.bob, s.alice, "accepted");
      await invite("hh-bob-carol", s.bob, s.carol, "pending");
      for (const inviteId of ["hh-alice-carol", "hh-bob-carol"]) {
        await ctx.db.insert("notifications", {
          userId: s.carol,
          type: "household_invite_received",
          title: "Household invite",
          message: "Household invite",
          isRead: false,
          createdAt: now,
          subject: { kind: "householdInvite", inviteId },
        });
      }
    });

    await deleteAlice(t);

    const left = await t.run(async (ctx) => ({
      invites: (await ctx.db.query("householdInvites").collect()).map(
        (row) => row.aggregateId,
      ),
      notifications: (await ctx.db.query("notifications").collect())
        .filter((row) => row.type === "household_invite_received")
        .map((row) =>
          row.subject?.kind === "householdInvite" ? row.subject.inviteId : "",
        ),
    }));
    expect(left.invites).toEqual(["hh-bob-carol"]);
    expect(left.notifications).toEqual(["hh-bob-carol"]);
  });
});
