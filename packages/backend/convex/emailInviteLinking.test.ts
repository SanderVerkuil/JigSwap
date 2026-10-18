import { convexTest, type TestConvex } from "convex-test";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  makeFakeInvitationGateway,
  type FakeInvitationGateway,
} from "./invitations/adapters/fakeInvitationGateway";
import schema from "./schema";

// Email invitations, the in-app side (#222, spec E1/E2): sign-up through the link (the Clerk
// user.created webhook), the fallbacks for an address that already belongs to a member, and
// their withdrawal. Clerk is never reached (the fake gateway); AhaSend is
// a stubbed fetch. The keys are dummy, non-secret test values.

const gate = vi.hoisted(() => ({
  gateway: null as FakeInvitationGateway | null,
}));
vi.mock("./invitations/adapters/invitationGateway", async (orig) => ({
  ...(await orig<typeof import("./invitations/adapters/invitationGateway")>()),
  makeInvitationGatewayFromEnv: () => gate.gateway,
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol";

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: [] }), { status: 202 }),
);
let gateway: FakeInvitationGateway;

beforeEach(() => {
  gateway = makeFakeInvitationGateway();
  gate.gateway = gateway;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv(
    "INVITE_EMAIL_HMAC_KEY",
    "test-only-dummy-invite-email-hmac-key-0123456789",
  );
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy_not_a_real_key");
  vi.stubEnv("AHASEND_API_KEY", "aha-sk-test");
  vi.stubEnv("AHASEND_ACCOUNT_ID", "acc-1");
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const seed = async (t: T) =>
  t.run(async (ctx) => {
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
    };
  });

// Alice admins a household with Bob as a plain member; Carol is in none.
const seedHousehold = (t: T, admin: Id<"users">, member: Id<"users">) =>
  t.run(async (ctx) => {
    const householdId = "hh_1";
    await ctx.db.insert("households", {
      aggregateId: householdId,
      createdAt: Date.now(),
    });
    for (const [memberId, role] of [
      [admin, "admin"],
      [member, "member"],
    ] as const) {
      await ctx.db.insert("householdMembers", {
        householdId,
        memberId,
        role,
        joinedAt: Date.now(),
      });
    }
    return householdId;
  });

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

const send = async (
  t: T,
  who: Who,
  email: string,
  kind: "follow" | "household" = "follow",
) => {
  const result = await as(t, who).action(
    api.invitations.sendEmailInvite.sendEmailInvite,
    { kind, email },
  );
  await settleDueJobs(t);
  return result;
};

const revoke = async (t: T, who: Who, inviteRef: string) => {
  await as(t, who).action(api.invitations.revokeEmailInvite.revokeEmailInvite, {
    inviteRef,
  });
  await settleDueJobs(t);
};

const emailInviteRows = (t: T) =>
  t.run((ctx) => ctx.db.query("emailInvites").collect());
const offers = (t: T) =>
  t.run((ctx) => ctx.db.query("connectionOffers").collect());
const householdInvites = (t: T) =>
  t.run((ctx) => ctx.db.query("householdInvites").collect());
const follows = (t: T) => t.run((ctx) => ctx.db.query("follows").collect());
const notificationsOf = (t: T, userId: Id<"users">, type: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter(
      (row) => row.userId === userId && row.type === type,
    ),
  );

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const myHouseholdPending = async (t: T, who: Who) =>
  (await as(t, who).query(api.household.getMyHousehold.getMyHousehold, {}))
    ?.pendingInvites ?? [];

describe("follow invite to an existing member", () => {
  test("a pending emailInvite offer, no follow, recorded on the row; accepting follows each other", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(await send(t, "alice", "carol@example.com")).toEqual({
      status: "sent",
    });

    const [offer] = await offers(t);
    expect(offer).toMatchObject({
      fromId: s.alice,
      toId: s.carol,
      source: "emailInvite",
      status: "pending",
    });
    expect(offer.inviteLinkId).toBeUndefined();
    expect(await follows(t)).toEqual([]);
    const [row] = await emailInviteRows(t);
    expect(row.fallback).toEqual({ connectionOfferId: offer.aggregateId });
    expect(
      await as(t, "carol").query(
        api.social.listMyConnectionOffers.listMyConnectionOffers,
        {},
      ),
    ).toMatchObject([{ offerId: offer.aggregateId, source: "emailInvite" }]);
    expect(
      await notificationsOf(t, s.carol, "connection_offer_received"),
    ).toHaveLength(1);

    await as(t, "carol").mutation(
      api.social.acceptConnection.acceptConnection,
      {
        offerId: offer.aggregateId,
      },
    );
    expect(
      (await follows(t)).map((f) => [f.followerId, f.followeeId]).sort(),
    ).toEqual(
      [
        [s.alice, s.carol],
        [s.carol, s.alice],
      ].sort(),
    );
  });

  test.each([
    ["the inviter blocked the member", "inviter"],
    ["the member blocked the inviter", "member"],
  ])("nothing when %s", async (_label, who) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    if (who === "inviter") await block(t, s.alice, s.carol);
    else await block(t, s.carol, s.alice);

    expect(await send(t, "alice", "carol@example.com")).toEqual({
      status: "sent",
    });
    expect(await offers(t)).toEqual([]);
    expect((await emailInviteRows(t))[0].fallback).toBeUndefined();
  });

  test("nothing when they already follow each other", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      for (const [followerId, followeeId] of [
        [s.alice, s.carol],
        [s.carol, s.alice],
      ]) {
        await ctx.db.insert("follows", {
          followerId,
          followeeId,
          createdAt: Date.now(),
        });
      }
    });

    await send(t, "alice", "carol@example.com");
    expect(await offers(t)).toEqual([]);
    expect((await emailInviteRows(t))[0].fallback).toBeUndefined();
  });

  test("nothing for the inviter's own address", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    expect(await send(t, "alice", "alice@example.com")).toEqual({
      status: "sent",
    });
    expect(await offers(t)).toEqual([]);
    expect(gateway.created).toEqual([]);
    expect((await emailInviteRows(t))[0].fallback).toBeUndefined();
  });

  test("revoking withdraws the pending offer and its notification", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await send(t, "alice", "carol@example.com");
    const [row] = await emailInviteRows(t);

    await revoke(t, "alice", row.aggregateId);

    expect(await offers(t)).toEqual([]);
    expect(
      await notificationsOf(t, s.carol, "connection_offer_received"),
    ).toEqual([]);
  });

  test("an answered offer stays when the invitation is revoked", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", "carol@example.com");
    const [row] = await emailInviteRows(t);
    await as(t, "carol").mutation(
      api.social.declineConnection.declineConnection,
      { offerId: row.fallback!.connectionOfferId! },
    );

    await revoke(t, "alice", row.aggregateId);

    expect((await offers(t)).map((offer) => offer.status)).toEqual([
      "declined",
    ]);
  });

  test("an open offer from a profile invite link is reused, not recorded, and survives a revoke", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const linkOffer = await t.run((ctx) =>
      ctx.db.insert("connectionOffers", {
        aggregateId: "offer-from-link",
        fromId: s.alice,
        toId: s.carol,
        source: "inviteLink",
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
      }),
    );

    await send(t, "alice", "carol@example.com");
    const [row] = await emailInviteRows(t);
    expect(row.fallback).toBeUndefined();
    expect((await offers(t)).map((offer) => offer._id)).toEqual([linkOffer]);

    await revoke(t, "alice", row.aggregateId);
    expect((await offers(t)).map((offer) => offer._id)).toEqual([linkOffer]);
  });
});

describe("household invite to an existing member", () => {
  test("a pending viaEmail invite, hidden from the admin's named list, visible to the member", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const householdId = await seedHousehold(t, s.alice, s.bob);

    expect(await send(t, "alice", "carol@example.com", "household")).toEqual({
      status: "sent",
    });

    const [invite] = await householdInvites(t);
    expect(invite).toMatchObject({
      householdId,
      inviterId: s.alice,
      inviteeId: s.carol,
      status: "pending",
      viaEmail: true,
    });
    expect((await emailInviteRows(t))[0].fallback).toEqual({
      householdInviteId: invite.aggregateId,
    });
    expect(await myHouseholdPending(t, "alice")).toEqual([]);
    expect(
      await as(t, "alice").query(
        api.invitations.listMyEmailInvites.listMyEmailInvites,
        { kind: "household" },
      ),
    ).toHaveLength(1);
    expect(
      await as(t, "carol").query(
        api.household.listMyHouseholdInvites.listMyHouseholdInvites,
        {},
      ),
    ).toHaveLength(1);
    expect(await follows(t)).toEqual([]);
  });

  test("nothing when the pair is blocked either way", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    await block(t, s.carol, s.alice);

    await send(t, "alice", "carol@example.com", "household");
    expect(await householdInvites(t)).toEqual([]);
    expect((await emailInviteRows(t))[0].fallback).toBeUndefined();
  });

  test("nothing for a member who is already in a household", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);

    await send(t, "alice", "bob@example.com", "household");
    expect(await householdInvites(t)).toEqual([]);
  });

  test("revoking withdraws the pending invite and its notification", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    await send(t, "alice", "carol@example.com", "household");
    expect(
      await notificationsOf(t, s.carol, "household_invite_received"),
    ).toHaveLength(1);
    const [row] = await emailInviteRows(t);

    await revoke(t, "alice", row.aggregateId);

    expect(await householdInvites(t)).toEqual([]);
    expect(
      await notificationsOf(t, s.carol, "household_invite_received"),
    ).toEqual([]);
  });

  test("an in-app invite of the same member takes the invite over: named, and kept on revoke", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    await send(t, "alice", "carol@example.com", "household");
    const [invite] = await householdInvites(t);

    // No DuplicateInvite: that would reveal whose address the email invitation went to.
    expect(
      await as(t, "alice").mutation(
        api.household.inviteToHousehold.inviteToHousehold,
        { inviteeId: s.carol },
      ),
    ).toBe(invite.aggregateId);
    expect(
      (await myHouseholdPending(t, "alice")).map((view) => view.inviteId),
    ).toEqual([invite.aggregateId]);

    const [row] = await emailInviteRows(t);
    await revoke(t, "alice", row.aggregateId);
    expect((await householdInvites(t)).map((r) => r.aggregateId)).toEqual([
      invite.aggregateId,
    ]);
  });

  test("an accepted invite stays when the invitation is revoked", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    await send(t, "alice", "carol@example.com", "household");
    const [invite] = await householdInvites(t);
    await as(t, "carol").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId: invite.aggregateId },
    );

    const [row] = await emailInviteRows(t);
    await revoke(t, "alice", row.aggregateId);
    expect((await householdInvites(t)).map((r) => r.status)).toEqual([
      "accepted",
    ]);
  });
});

// --- sign-up through the link: the svix-signed Clerk webhook ---

const WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldA==";

const postUserEvent = async (
  t: T,
  type: "user.created" | "user.updated",
  publicMetadata: unknown,
) => {
  const body = JSON.stringify({
    type,
    data: {
      id: "clerk_newbie",
      first_name: "New",
      last_name: "Bie",
      username: "newbie",
      image_url: "",
      created_at: Date.now(),
      updated_at: Date.now(),
      public_metadata: publicMetadata,
      primary_email_address_id: "idn_1",
      email_addresses: [
        {
          id: "idn_1",
          email_address: "newbie@example.org",
          verification: { status: "verified" },
        },
      ],
    },
  });
  const msgId = `msg_${Math.random()}`;
  const timestamp = new Date();
  const response = await t.fetch("/clerk-users-webhook", {
    method: "POST",
    headers: {
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": new Webhook(WEBHOOK_SECRET).sign(
        msgId,
        timestamp,
        body,
      ),
    },
    body,
  });
  expect(response.status).toBe(200);
  await settleDueJobs(t);
};

const newbieId = (t: T) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_newbie"))
          .unique()
      )?._id,
  );

const inviteNewbie = async (t: T, kind: "follow" | "household" = "follow") => {
  await send(t, "alice", "newbie@example.org", kind);
  const [row] = await emailInviteRows(t);
  return row;
};

describe("sign-up through an email invitation", () => {
  beforeEach(() => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", WEBHOOK_SECRET);
  });

  test("follow: a pending offer from the inviter and no follow; accepting follows each other", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const row = await inviteNewbie(t);

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "follow", ref: row.aggregateId },
    });

    const newbie = await newbieId(t);
    const [offer] = await offers(t);
    expect(offer).toMatchObject({
      fromId: s.alice,
      toId: newbie,
      source: "emailInvite",
      status: "pending",
    });
    expect(await follows(t)).toEqual([]);
    expect(await emailInviteRows(t)).toEqual([]);
    expect(gateway.cleared).toEqual(["clerk_newbie"]);

    await t
      .withIdentity({ subject: "clerk_newbie" })
      .mutation(api.social.acceptConnection.acceptConnection, {
        offerId: offer.aggregateId,
      });
    expect(await follows(t)).toHaveLength(2);
  });

  test("household: a pending invite into the inviter's household, named for the admin, no follow", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const householdId = await seedHousehold(t, s.alice, s.bob);
    const row = await inviteNewbie(t, "household");

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "household", ref: row.aggregateId },
    });

    const newbie = await newbieId(t);
    const [invite] = await householdInvites(t);
    expect(invite).toMatchObject({
      householdId,
      inviterId: s.alice,
      inviteeId: newbie,
      status: "pending",
    });
    expect(invite.viaEmail).toBeUndefined();
    expect(
      (await myHouseholdPending(t, "alice")).map((view) => view.inviteId),
    ).toEqual([invite.aggregateId]);
    expect(await offers(t)).toEqual([]);
    expect(await follows(t)).toEqual([]);
    expect(await emailInviteRows(t)).toEqual([]);
  });

  test("household: nothing when the inviter is no longer the admin", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    const row = await inviteNewbie(t, "household");
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query("householdMembers").collect()) {
        await ctx.db.patch(m._id, {
          role: m.memberId === s.alice ? "member" : "admin",
        });
      }
    });

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "household", ref: row.aggregateId },
    });

    expect(await householdInvites(t)).toEqual([]);
    expect(await emailInviteRows(t)).toEqual([]);
  });

  test.each([
    ["no metadata", null],
    ["no jsInvite", { role: "admin" }],
    ["a string jsInvite", { jsInvite: "follow" }],
    ["an unknown kind", { jsInvite: { kind: "circle", ref: "REF" } }],
    ["a non-string ref", { jsInvite: { kind: "follow", ref: 42 } }],
    ["a ref that isn't ours", { jsInvite: { kind: "follow", ref: "a b;c" } }],
  ])("ignores %s", async (_label, metadata) => {
    const t = convexTest(schema, modules);
    await seed(t);
    const row = await inviteNewbie(t);
    const withRef = JSON.parse(
      JSON.stringify(metadata).replace("REF", row.aggregateId),
    );

    await postUserEvent(t, "user.created", withRef);

    expect(await newbieId(t)).toBeDefined();
    expect(await offers(t)).toEqual([]);
    expect(await emailInviteRows(t)).toHaveLength(1);
    expect(gateway.cleared).toEqual([]);
  });

  test("an unknown ref does nothing, but the ref is still cleared", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await inviteNewbie(t);

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "follow", ref: "00000000-0000-0000-0000-000000000000" },
    });

    expect(await offers(t)).toEqual([]);
    expect(await emailInviteRows(t)).toHaveLength(1);
    expect(gateway.cleared).toEqual(["clerk_newbie"]);
  });

  test("a kind mismatch does nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    const row = await inviteNewbie(t, "household");

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "follow", ref: row.aggregateId },
    });

    expect(await offers(t)).toEqual([]);
    expect(await householdInvites(t)).toEqual([]);
    expect(await emailInviteRows(t)).toHaveLength(1);
  });

  test("a revoked invitation does nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const row = await inviteNewbie(t);
    await revoke(t, "alice", row.aggregateId);

    await postUserEvent(t, "user.created", {
      jsInvite: { kind: "follow", ref: row.aggregateId },
    });

    expect(await offers(t)).toEqual([]);
  });

  test("only user.created applies it, and a redelivery makes no second offer", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const row = await inviteNewbie(t);
    const metadata = { jsInvite: { kind: "follow", ref: row.aggregateId } };

    await postUserEvent(t, "user.updated", metadata);
    expect(await offers(t)).toEqual([]);
    expect(await emailInviteRows(t)).toHaveLength(1);

    await postUserEvent(t, "user.created", metadata);
    await postUserEvent(t, "user.created", metadata);
    expect(await offers(t)).toHaveLength(1);
  });
});
