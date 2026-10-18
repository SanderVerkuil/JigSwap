import { EMAIL_ELIGIBLE_TYPES } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Circle invitations: an Admin invites a member they may contact (not blocked either way, and a
// mutual follow), the invitee accepts (joins) or declines (silent), the inviter
// or an Admin revokes, and an unanswered invite expires after 14 days. A pending invite is NOT a
// membership.

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave" | "eve";

const DAY = 24 * 60 * 60 * 1000;

// Alice owns the circle; Bob is an Admin, Dave a ViewOnly member; Carol and Eve are outsiders.
// Every profile is PRIVATE, so identity and copies are only reachable through the rules under test.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = async (who: Who) => {
      const id = await ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        memberId: id,
        visibility: "private",
        updatedAt: now,
      });
      return id;
    };
    return {
      alice: await mk("alice"),
      bob: await mk("bob"),
      carol: await mk("carol"),
      dave: await mk("dave"),
      eve: await mk("eve"),
    };
  });
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Saturday Puzzlers" },
  )) as string;
  await as(t, "alice").mutation(api.sharing.addMember.addMember, {
    circleId,
    memberId: ids.bob,
    permission: "Admin",
  });
  await as(t, "alice").mutation(api.sharing.addMember.addMember, {
    circleId,
    memberId: ids.dave,
    permission: "ViewOnly",
  });
  return { ...ids, circleId };
};

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const mutualFollow = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("follows", {
      followerId: a,
      followeeId: b,
      createdAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: b,
      followeeId: a,
      createdAt: now,
    });
  });

const followOneWay = (t: T, follower: Id<"users">, followee: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: follower,
      followeeId: followee,
      createdAt: Date.now(),
    });
  });

const pairThread = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    const aggregateId = crypto.randomUUID();
    await ctx.db.insert("threads", {
      aggregateId,
      subjectKind: "dm",
      participants: [a, b],
      participantsKey: [a, b].sort().join("|"),
      readReceipts: [],
      createdAt: Date.now(),
    });
    for (const memberId of [a, b]) {
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: aggregateId,
        memberId,
      });
    }
  });

const pairThreadExists = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query("threads")
        .withIndex("by_participants_key", (q) =>
          q.eq("participantsKey", [a, b].sort().join("|")),
        )
        .first()) !== null,
  );

const unfollow = (t: T, follower: Id<"users">, followee: Id<"users">) =>
  t.run(async (ctx) => {
    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", follower).eq("followeeId", followee),
      )
      .first();
    if (edge) await ctx.db.delete(edge._id);
  });

const block = (t: T, blocker: Id<"users">, blocked: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("blocks", {
      blockerId: blocker,
      blockedId: blocked,
      createdAt: Date.now(),
    });
  });

const invite = (
  t: T,
  who: Who,
  circleId: string,
  inviteeId: Id<"users">,
  permission: "ViewOnly" | "Exchange" | "Admin" = "Exchange",
) =>
  as(t, who).mutation(api.sharing.inviteToCircle.inviteToCircle, {
    circleId,
    inviteeId,
    permission,
  });

const accept = (t: T, who: Who, inviteId: string) =>
  as(t, who).mutation(api.sharing.acceptCircleInvite.acceptCircleInvite, {
    inviteId,
  });

const decline = (t: T, who: Who, inviteId: string) =>
  as(t, who).mutation(api.sharing.declineCircleInvite.declineCircleInvite, {
    inviteId,
  });

const revoke = (t: T, who: Who, inviteId: string) =>
  as(t, who).mutation(api.sharing.revokeCircleInvite.revokeCircleInvite, {
    inviteId,
  });

const inviteRow = (t: T, inviteId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("circleInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
      .unique(),
  );

const allInvites = (t: T) =>
  t.run((ctx) => ctx.db.query("circleInvites").collect());

const circleRow = (t: T, circleId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .unique(),
  );

const isSeated = async (t: T, circleId: string, memberId: Id<"users">) => {
  const row = await circleRow(t, circleId);
  const link = await t.run((ctx) =>
    ctx.db
      .query("circleMembers")
      .withIndex("by_circle_member", (q) =>
        q.eq("circleAggregateId", circleId).eq("memberId", memberId),
      )
      .first(),
  );
  return {
    seat: row?.memberships.find((m) => m.memberId === memberId) ?? null,
    link: link !== null,
  };
};

const eventsNamed = (t: T, name: string) =>
  t.run((ctx) =>
    ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", name))
      .collect(),
  );

// Move an invite's clock into the past so it is due/expired now.
const backdate = (t: T, inviteId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("circleInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
      .unique();
    if (!row) throw new Error("seed: invite not found");
    await ctx.db.patch(row._id, {
      createdAt: row.createdAt - 15 * DAY,
      expiresAt: row.expiresAt - 15 * DAY,
    });
  });

// Seat `count` fresh members in the circle through the public addMember path.
const fillSeats = async (t: T, circleId: string, count: number) => {
  for (let i = 0; i < count; i++) {
    const memberId = await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: `clerk_seat_${crypto.randomUUID()}`,
        email: `seat${i}@example.com`,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await as(t, "alice").mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
};

// A fresh outsider Alice may contact (mutual follow).
const contactableOutsider = async (t: T, alice: Id<"users">) => {
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_out_${crypto.randomUUID()}`,
      email: "out@example.com",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await mutualFollow(t, alice, id);
  return id;
};

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsOf = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

const viewsOf = async (t: T, who: Who) =>
  (
    await as(t, who).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 20, cursor: null } },
    )
  ).page;

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

describe("sharing.inviteToCircle", () => {
  test("an Admin invites a mutual follow: a pending 14-day invite with its expiry scheduled", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);

    const inviteId = await invite(t, "alice", circleId, carol, "Exchange");

    const row = await inviteRow(t, inviteId);
    expect(row).toMatchObject({
      circleAggregateId: circleId,
      inviteeId: carol,
      inviterId: alice,
      permission: "Exchange",
      status: "pending",
    });
    expect(row!.expiresAt - row!.createdAt).toBe(14 * DAY);
    const issued = await eventsNamed(t, "CircleInviteIssued");
    expect(issued).toHaveLength(1);
    expect(issued[0].payload).toEqual({
      inviteId,
      circleId,
      inviterId: alice,
      inviteeId: carol,
      expiresAt: row!.expiresAt,
    });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const job = scheduled.find((s) => s.name.includes("expireCircleInvite"));
    expect(job?.scheduledTime).toBe(row!.expiresAt);
    expect(job?.args[0]).toEqual({ inviteId });
  });

  test("another Admin may invite their own mutual follow", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    await mutualFollow(t, bob, carol);

    const inviteId = await invite(t, "bob", circleId, carol);
    expect((await inviteRow(t, inviteId))?.inviterId).toBe(bob);
  });

  test("a non-admin member is refused; a non-member gets CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { dave, eve, carol, circleId } = await seed(t);
    await mutualFollow(t, dave, carol);
    await mutualFollow(t, eve, carol);

    await expectConvexCode(
      invite(t, "dave", circleId, carol),
      "NotCircleAdmin",
    );
    await expectConvexCode(invite(t, "eve", circleId, carol), "CircleNotFound");
    await expectConvexCode(
      invite(t, "eve", "no-such-circle", carol),
      "CircleNotFound",
    );
    expect(await allInvites(t)).toEqual([]);
  });

  test("every contact-rule failure is the same CannotInvite", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, eve, circleId } = await seed(t);

    // No follow and no thread at all.
    await expectConvexCode(invite(t, "alice", circleId, eve), "CannotInvite");
    // A one-way follow is not a mutual follow.
    await followOneWay(t, alice, eve);
    await expectConvexCode(invite(t, "alice", circleId, eve), "CannotInvite");
    // Mutual follow, but Alice blocked Carol.
    await mutualFollow(t, alice, carol);
    await block(t, alice, carol);
    await expectConvexCode(invite(t, "alice", circleId, carol), "CannotInvite");
    expect(await allInvites(t)).toEqual([]);
  });

  test("being blocked BY the invitee is the same CannotInvite", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await block(t, carol, alice);

    await expectConvexCode(invite(t, "alice", circleId, carol), "CannotInvite");
  });

  test("a shared circle alone does not make someone invitable", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    // Bob and Carol share another circle, but neither follow each other nor have a thread.
    const other = (await as(t, "bob").mutation(
      api.sharing.createCircle.createCircle,
      { name: "Other" },
    )) as string;
    await as(t, "bob").mutation(api.sharing.addMember.addMember, {
      circleId: other,
      memberId: carol,
      permission: "ViewOnly",
    });

    await expectConvexCode(invite(t, "bob", circleId, carol), "CannotInvite");

    // The shared circle lets Bob open a DM to Carol without her consent; that thread doesn't
    // count either.
    await as(t, "bob").mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: carol,
    });
    expect(await pairThreadExists(t, bob, carol)).toBe(true);
    await expectConvexCode(invite(t, "bob", circleId, carol), "CannotInvite");
  });

  test("an exchange-proposal thread does not make someone invitable", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    // Carol offers a copy for sale; Alice proposes on it, which opens a thread with no connection.
    const copy = await t.run(async (ctx) => {
      const now = Date.now();
      const puzzleId = await ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: "Harbour",
        brand: "Ravensburger",
        pieceCount: 500,
        searchableText: "Harbour Ravensburger",
        status: "approved",
        submittedBy: carol,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: carol,
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    });
    await as(t, "alice").mutation(api.exchange.propose.propose, {
      type: "sale",
      requestedPuzzleId: copy,
      salePrice: 1000,
    });
    await flushScheduled(t);
    expect(await pairThreadExists(t, alice, carol)).toBe(true);

    await expectConvexCode(invite(t, "alice", circleId, carol), "CannotInvite");
  });

  test("self and existing members are refused", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    await mutualFollow(t, alice, dave);

    await expectConvexCode(
      invite(t, "alice", circleId, alice),
      "AlreadyMember",
    );
    await expectConvexCode(invite(t, "alice", circleId, dave), "AlreadyMember");
  });

  test("re-inviting while an invite is pending returns the same invite", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, bob, carol);

    const first = await invite(t, "alice", circleId, carol);
    const again = await invite(t, "bob", circleId, carol, "Admin");

    expect(again).toBe(first);
    expect(await allInvites(t)).toHaveLength(1);
    expect(await eventsNamed(t, "CircleInviteIssued")).toHaveLength(1);
  });

  test("a stale pending invite (past expiry) is expired and replaced", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const first = await invite(t, "alice", circleId, carol);
    await backdate(t, first);

    const second = await invite(t, "alice", circleId, carol);

    expect(second).not.toBe(first);
    expect((await inviteRow(t, first))?.status).toBe("expired");
    expect((await inviteRow(t, second))?.status).toBe("pending");
  });

  test("after a decline or revoke the same invitee can't be re-invited for 7 days", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, eve, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, bob, carol);
    await mutualFollow(t, alice, eve);
    const toCarol = await invite(t, "alice", circleId, carol);
    await decline(t, "carol", toCarol);
    const toEve = await invite(t, "alice", circleId, eve);
    await revoke(t, "bob", toEve);

    // Any Admin, any permission: the same generic refusal.
    await expectConvexCode(invite(t, "bob", circleId, carol), "CannotInvite");
    await expectConvexCode(invite(t, "alice", circleId, eve), "CannotInvite");
    const picker = await as(t, "alice").query(
      api.sharing.listInvitableMembers.listInvitableMembers,
      { circleId },
    );
    expect(picker.map((m) => m.member._id)).not.toContain(carol);
    expect(picker.map((m) => m.member._id)).not.toContain(eve);

    // Once the decisions are more than 7 days old, inviting works again.
    for (const inviteId of [toCarol, toEve]) {
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("circleInvites")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
          .unique();
        await ctx.db.patch(row!._id, { decidedAt: row!.decidedAt! - 7 * DAY });
      });
    }
    expect(await invite(t, "bob", circleId, carol)).not.toBe(toCarol);
    expect(await invite(t, "alice", circleId, eve)).not.toBe(toEve);
  });

  test("pending invites count against the 50 cap", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    // 3 seated + 45 = 48 members; two open invites take the last two places.
    await fillSeats(t, circleId, 45);
    await invite(t, "alice", circleId, await contactableOutsider(t, alice));
    await invite(t, "alice", circleId, await contactableOutsider(t, alice));

    await expectConvexCode(
      invite(t, "alice", circleId, await contactableOutsider(t, alice)),
      "CircleFull",
    );
  });

  test("is rate limited per inviter", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);

    for (let i = 0; i < RATE_LIMITS.circleInvite.max; i++) {
      await invite(t, "alice", circleId, carol);
    }
    expect(RATE_LIMITS.circleInvite).toEqual({ windowMs: DAY, max: 30 });
    await expectConvexCode(invite(t, "alice", circleId, carol), "RateLimited");
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId } = await seed(t);
    await expect(
      t.mutation(api.sharing.inviteToCircle.inviteToCircle, {
        circleId,
        inviteeId: carol,
        permission: "ViewOnly",
      }),
    ).rejects.toThrow();
  });
});

describe("sharing.acceptCircleInvite", () => {
  const invited = async (t: T, inviter: Who = "alice") => {
    const ids = await seed(t);
    await mutualFollow(t, ids[inviter], ids.carol);
    const inviteId = await invite(t, inviter, ids.circleId, ids.carol);
    return { ...ids, inviteId };
  };

  test("the invitee joins at the invite's permission, with MemberJoinedCircle and a circleMembers row", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId, inviteId } = await invited(t);

    expect(await accept(t, "carol", inviteId)).toBe(circleId);

    const { seat, link } = await isSeated(t, circleId, carol);
    expect(seat?.permission).toBe("Exchange");
    expect(link).toBe(true);
    expect((await inviteRow(t, inviteId))?.status).toBe("accepted");
    expect((await inviteRow(t, inviteId))?.decidedAt).toBeTypeOf("number");
    const joined = await eventsNamed(t, "MemberJoinedCircle");
    expect(joined.map((e) => e.payload)).toContainEqual({
      circleId,
      memberId: carol,
    });
    expect(
      (await eventsNamed(t, "CircleInviteAccepted")).map((e) => e.payload),
    ).toEqual([
      { inviteId, circleId, inviteeId: carol, inviterId: expect.any(String) },
    ]);
  });

  test("only the invitee may accept; anyone else gets InviteNotFound like an unknown id", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId, inviteId } = await invited(t);

    for (const who of ["alice", "bob", "eve"] as const) {
      await expectConvexCode(accept(t, who, inviteId), "InviteNotFound");
    }
    await expectConvexCode(
      accept(t, "carol", "no-such-invite"),
      "InviteNotFound",
    );
    expect((await isSeated(t, circleId, carol)).seat).toBeNull();
    expect((await inviteRow(t, inviteId))?.status).toBe("pending");
  });

  test("an invite past its expiry is refused even before the scheduled flip", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId, inviteId } = await invited(t);
    await backdate(t, inviteId);

    await expectConvexCode(accept(t, "carol", inviteId), "InviteExpired");
    expect((await isSeated(t, circleId, carol)).seat).toBeNull();
  });

  test("a block either way since the invite refuses generically", async () => {
    for (const blockerIsInvitee of [true, false]) {
      const t = convexTest(schema, modules);
      const { alice, carol, circleId, inviteId } = await invited(t);
      if (blockerIsInvitee) await block(t, carol, alice);
      else await block(t, alice, carol);

      await expectConvexCode(accept(t, "carol", inviteId), "InviteNotFound");
      expect((await isSeated(t, circleId, carol)).seat).toBeNull();
      expect((await inviteRow(t, inviteId))?.status).toBe("pending");
    }
  });

  test("an inviter who is no longer an Admin can't bring anyone in (even if the invite survived)", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId, inviteId } = await invited(t, "bob");
    // Demote Bob directly in the row, bypassing changePermission's withdrawal, so the invite is
    // still pending: accept must re-check the inviter's standing on its own.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      await ctx.db.patch(row!._id, {
        memberships: row!.memberships.map((m) =>
          m.memberId === bob ? { ...m, permission: "ViewOnly" as const } : m,
        ),
      });
    });
    expect((await inviteRow(t, inviteId))?.status).toBe("pending");

    await expectConvexCode(accept(t, "carol", inviteId), "InviteNotFound");
    expect((await isSeated(t, circleId, carol)).seat).toBeNull();
  });

  test("the cap is re-checked at accept (members only)", async () => {
    const t = convexTest(schema, modules);
    const { circleId, inviteId } = await invited(t);
    // 3 + 1 open invite; seating 47 more fills the circle to 50 members.
    await fillSeats(t, circleId, 47);

    await expectConvexCode(accept(t, "carol", inviteId), "CircleFull");
    expect((await inviteRow(t, inviteId))?.status).toBe("pending");
  });

  test("an already-decided invite can't be accepted", async () => {
    const t = convexTest(schema, modules);
    const { inviteId } = await invited(t);
    await decline(t, "carol", inviteId);

    await expectConvexCode(accept(t, "carol", inviteId), "InviteNotPending");
  });
});

describe("sharing.declineCircleInvite", () => {
  test("the invitee declines: the invite leaves the pending list, nothing is joined", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);

    await decline(t, "carol", inviteId);

    expect((await inviteRow(t, inviteId))?.status).toBe("declined");
    expect((await isSeated(t, circleId, carol)).seat).toBeNull();
    expect(
      await as(t, "alice").query(
        api.sharing.listCircleInvites.listCircleInvites,
        {
          circleId,
        },
      ),
    ).toEqual([]);
  });

  test("someone else's or an unknown invite is InviteNotFound", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);

    await expectConvexCode(decline(t, "alice", inviteId), "InviteNotFound");
    await expectConvexCode(decline(t, "carol", "nope"), "InviteNotFound");
  });
});

describe("sharing.revokeCircleInvite", () => {
  test("the inviter and any other Admin may revoke; a plain member may not", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, eve, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, alice, eve);
    const toCarol = await invite(t, "alice", circleId, carol);
    const toEve = await invite(t, "alice", circleId, eve);

    await expectConvexCode(revoke(t, "dave", toCarol), "InviteNotFound");
    await expectConvexCode(revoke(t, "carol", toCarol), "InviteNotFound");
    expect((await inviteRow(t, toCarol))?.status).toBe("pending");

    await revoke(t, "alice", toCarol);
    await revoke(t, "bob", toEve);
    expect((await inviteRow(t, toCarol))?.status).toBe("revoked");
    expect((await inviteRow(t, toEve))?.status).toBe("revoked");

    // Revoked is final.
    await expectConvexCode(accept(t, "carol", toCarol), "InviteNotPending");
    await expectConvexCode(revoke(t, "alice", toCarol), "InviteNotPending");
  });
});

describe("an inviter who leaves, is removed or loses Admin", () => {
  for (const exit of ["leaves", "is removed", "is demoted"] as const) {
    test(`${exit}: their pending invites are withdrawn in the same transaction`, async () => {
      const t = convexTest(schema, modules);
      const { alice, bob, carol, eve, circleId } = await seed(t);
      await mutualFollow(t, bob, carol);
      await mutualFollow(t, alice, eve);
      await mutualFollow(t, alice, carol);
      const fromBob = await invite(t, "bob", circleId, carol);
      const fromAlice = await invite(t, "alice", circleId, eve);

      if (exit === "leaves") {
        await as(t, "bob").mutation(api.sharing.leaveCircle.leaveCircle, {
          circleId,
        });
      } else if (exit === "is removed") {
        await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
          circleId,
          memberId: bob,
        });
      } else {
        await as(t, "alice").mutation(
          api.sharing.changePermission.changePermission,
          { circleId, memberId: bob, permission: "Exchange" },
        );
      }

      const row = await inviteRow(t, fromBob);
      expect(row?.status).toBe("revoked");
      expect(row?.revokedBy).toBeUndefined();
      expect((await inviteRow(t, fromAlice))?.status).toBe("pending");
      // The seat is free again and the list no longer shows it.
      expect(
        (
          await as(t, "alice").query(
            api.sharing.listCircleInvites.listCircleInvites,
            { circleId },
          )
        ).map((i) => i.inviteId),
      ).toEqual([fromAlice]);
      // Carol can't join on it, and the ex-inviter can't act on it any more.
      await expectConvexCode(accept(t, "carol", fromBob), "InviteNotPending");
      await expectConvexCode(revoke(t, "bob", fromBob), "InviteNotPending");
      // A withdrawal holds no re-invite off: another Admin can invite Carol straight away.
      expect(await invite(t, "alice", circleId, carol)).not.toBe(fromBob);
    });
  }

  test("a permission change that keeps Admin leaves the invites alone", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, dave, circleId } = await seed(t);
    await mutualFollow(t, bob, carol);
    const fromBob = await invite(t, "bob", circleId, carol);
    await as(t, "alice").mutation(
      api.sharing.changePermission.changePermission,
      {
        circleId,
        memberId: dave,
        permission: "Admin",
      },
    );
    expect((await inviteRow(t, fromBob))?.status).toBe("pending");
  });
});

describe("sharing.expireCircleInvite (scheduled)", () => {
  test("flips a due pending invite to expired", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);
    await backdate(t, inviteId);

    expect(
      await t.mutation(internal.sharing.expireCircleInvite.expireCircleInvite, {
        inviteId,
      }),
    ).toBe(true);
    expect((await inviteRow(t, inviteId))?.status).toBe("expired");
    expect(await eventsNamed(t, "CircleInviteExpired")).toHaveLength(1);
  });

  test("is a no-op once the invite was decided", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);
    await accept(t, "carol", inviteId);
    await backdate(t, inviteId);

    expect(
      await t.mutation(internal.sharing.expireCircleInvite.expireCircleInvite, {
        inviteId,
      }),
    ).toBe(false);
    expect((await inviteRow(t, inviteId))?.status).toBe("accepted");
    expect(await eventsNamed(t, "CircleInviteExpired")).toHaveLength(0);
  });
});

describe("a pending invite is not membership", () => {
  test("the invitee can't see the circle, its member list or a circle-shared copy", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    // Alice invites her mutual follow Carol; the shared copy is Bob's (Carol has no tie to Bob).
    await mutualFollow(t, alice, carol);

    const puzzleId = await t.run(async (ctx) => {
      const now = Date.now();
      const aggregateId = crypto.randomUUID();
      await ctx.db.insert("puzzles", {
        aggregateId,
        title: "Mountain Vista",
        brand: "Ravensburger",
        pieceCount: 1000,
        searchableText: "Mountain Vista Ravensburger",
        status: "approved",
        submittedBy: alice,
        createdAt: now,
        updatedAt: now,
      });
      return aggregateId;
    });
    const copyId = (await as(t, "bob").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleId, condition: "good" },
    )) as string;
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      await ctx.db.patch(row!._id, {
        availability: { forTrade: false, forSale: false, forLend: true },
      });
    });
    await as(t, "bob").mutation(
      api.sharing.shareCopyToCircle.shareCopyToCircle,
      {
        circleId,
        copyId,
      },
    );
    const browse = async (who: Who) =>
      (
        await as(t, who).query(
          api.library.browseOwnedPuzzles.browseOwnedPuzzles,
          {},
        )
      ).ownedPuzzles.map((c) => c.aggregateId);
    // Precondition: a real member (Dave) reaches the copy through the circle.
    expect(await browse("dave")).toContain(copyId);

    const inviteId = await invite(t, "alice", circleId, carol);

    expect(await browse("carol")).not.toContain(copyId);
    expect(
      await as(t, "carol").query(api.sharing.getCircle.getCircle, { circleId }),
    ).toBeNull();
    expect(
      await as(t, "carol").query(api.sharing.listMyCircles.listMyCircles, {}),
    ).toEqual([]);
    const members = await as(t, "alice").query(
      api.sharing.getCircle.getCircle,
      {
        circleId,
      },
    );
    expect(members?.members.map((m) => m.memberId)).not.toContain(carol);
    expect((await isSeated(t, circleId, carol)).link).toBe(false);

    // After accepting, the same reads open up.
    await accept(t, "carol", inviteId);
    expect(await browse("carol")).toContain(copyId);
  });
});

describe("sharing.listMyCircleInvites", () => {
  test("the invitee sees name, size, projected inviter, permission and expiry, never members", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol, "ViewOnly");
    const row = await inviteRow(t, inviteId);

    const mine = await as(t, "carol").query(
      api.sharing.listMyCircleInvites.listMyCircleInvites,
      {},
    );

    expect(mine).toHaveLength(1);
    const [view] = mine;
    expect(Object.keys(view).sort()).toEqual(
      [
        "circleName",
        "expiresAt",
        "inviteId",
        "inviter",
        "memberCount",
        "permission",
      ].sort(),
    );
    expect(view).toMatchObject({
      inviteId,
      circleName: "Saturday Puzzlers",
      memberCount: 3,
      permission: "ViewOnly",
      expiresAt: row!.expiresAt,
    });
    // Alice is private but a mutual follow, so the chokepoint reveals her.
    expect(view.inviter.anonymous).toBe(false);
    if (!view.inviter.anonymous) expect(view.inviter.member._id).toBe(alice);
  });

  test("a private inviter who has since unfollowed is anonymised", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await invite(t, "alice", circleId, carol);
    await unfollow(t, alice, carol);

    const [view] = await as(t, "carol").query(
      api.sharing.listMyCircleInvites.listMyCircleInvites,
      {},
    );
    expect(view.inviter.anonymous).toBe(true);
    expect(JSON.stringify(view.inviter)).not.toContain(alice);
  });

  test("leaves out expired, decided, blocked and dead-end invites; others see none", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, eve, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, bob, eve);
    const expired = await invite(t, "alice", circleId, carol);
    await backdate(t, expired);
    const toEve = await invite(t, "bob", circleId, eve);
    expect(
      await as(t, "eve").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toHaveLength(1);

    // Bob loses Admin: his invite would be refused, so it is no longer listed.
    await as(t, "alice").mutation(
      api.sharing.changePermission.changePermission,
      {
        circleId,
        memberId: bob,
        permission: "ViewOnly",
      },
    );
    expect(
      await as(t, "eve").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toEqual([]);
    expect(
      await as(t, "carol").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toEqual([]);
    // Nobody else sees Eve's invite.
    expect(
      await as(t, "alice").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toEqual([]);
    expect(toEve).toBeTypeOf("string");

    // A block hides a fresh invite from the invitee too.
    const fresh = await invite(t, "alice", circleId, carol);
    await block(t, alice, carol);
    expect(
      await as(t, "carol").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toEqual([]);
    expect(fresh).toBeTypeOf("string");
  });
});

describe("sharing.listCircleInvites", () => {
  test("Admins see the open invites with projected invitee and inviter", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, eve, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, alice, eve);
    const toCarol = await invite(t, "alice", circleId, carol);
    const toEve = await invite(t, "alice", circleId, eve);
    await backdate(t, toEve);

    for (const who of ["alice", "bob"] as const) {
      const list = await as(t, who).query(
        api.sharing.listCircleInvites.listCircleInvites,
        { circleId },
      );
      expect(list.map((i) => i.inviteId)).toEqual([toCarol]);
      expect(Object.keys(list[0]).sort()).toEqual(
        ["createdAt", "expiresAt", "invitedBy", "invitee", "inviteId"].sort(),
      );
    }
    // Alice follows Carol mutually; Bob doesn't, and Carol is private.
    const [forAlice] = await as(t, "alice").query(
      api.sharing.listCircleInvites.listCircleInvites,
      { circleId },
    );
    expect(forAlice.invitee.anonymous).toBe(false);
    const [forBob] = await as(t, "bob").query(
      api.sharing.listCircleInvites.listCircleInvites,
      { circleId },
    );
    expect(forBob.invitee.anonymous).toBe(true);
  });

  test("a plain member, a non-member and the invitee get CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await invite(t, "alice", circleId, carol);

    for (const who of ["dave", "eve", "carol"] as const) {
      await expectConvexCode(
        as(t, who).query(api.sharing.listCircleInvites.listCircleInvites, {
          circleId,
        }),
        "CircleNotFound",
      );
    }
  });
});

describe("sharing.listInvitableMembers", () => {
  test("lists contactable outsiders only, minus members, open invitees and blocked members", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, dave, eve, circleId } = await seed(t);
    const mk = (name: string) =>
      t.run((ctx) =>
        ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    const frank = await mk("Frank"); // public (no profile row), mutual follow
    const joe = await mk("Joe"); // public, pair thread only: a thread is not contact
    const gina = await mk("Gina"); // mutual follow, then blocked
    const hank = await mk("Hank"); // one-way follow only
    const ivy = await mk("Ivy"); // mutual follow, already invited
    await mutualFollow(t, alice, carol);
    await mutualFollow(t, alice, dave); // already a member
    await mutualFollow(t, alice, frank);
    await pairThread(t, alice, joe);
    await mutualFollow(t, alice, gina);
    await block(t, gina, alice);
    await followOneWay(t, alice, hank);
    await mutualFollow(t, alice, ivy);
    await pairThread(t, alice, eve); // private, thread only
    await invite(t, "alice", circleId, ivy);

    const list = await as(t, "alice").query(
      api.sharing.listInvitableMembers.listInvitableMembers,
      { circleId },
    );
    expect(list.map((m) => m.member._id).sort()).toEqual([carol, frank].sort());
    expect(list.every((m) => m.anonymous === false)).toBe(true);

    const searched = await as(t, "alice").query(
      api.sharing.listInvitableMembers.listInvitableMembers,
      { circleId, search: " fRa " },
    );
    expect(searched.map((m) => m.member._id)).toEqual([frank]);
  });

  test("scans at most 500 of the Admin's follow edges", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        const other = await ctx.db.insert("users", {
          clerkId: `clerk_bulk_${i}`,
          email: `bulk${i}@example.com`,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("follows", {
          followerId: alice,
          followeeId: other,
          createdAt: Date.now(),
        });
      }
    });
    // Carol's mutual edge comes after the first 500 edges, so this read doesn't reach it.
    await mutualFollow(t, alice, carol);

    expect(
      await as(t, "alice").query(
        api.sharing.listInvitableMembers.listInvitableMembers,
        { circleId },
      ),
    ).toEqual([]);
  });

  test("Admins only: others get CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    for (const who of ["dave", "eve"] as const) {
      await expectConvexCode(
        as(t, who).query(
          api.sharing.listInvitableMembers.listInvitableMembers,
          {
            circleId,
          },
        ),
        "CircleNotFound",
      );
    }
  });
});

describe("circle invite notifications", () => {
  test("the invitee is notified (actor = inviter, circleInvite subject), deep-linked while open", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);
    await flushScheduled(t);

    const rows = await notificationsOf(t, carol);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "circle_invite_received",
      relatedId: inviteId,
      actorIds: [alice],
      subject: { kind: "circleInvite", inviteId },
    });
    // No name snapshot: the actor is resolved live through the privacy rules.
    expect(rows[0].params?.actorName).toBeUndefined();

    const [view] = await viewsOf(t, "carol");
    expect(view.context.circleName).toBe("Saturday Puzzlers");
    expect(view.href).toBe(`/circles?invite=${inviteId}`);
    expect(view.actors[0]).toMatchObject({ anonymous: false, memberId: alice });

    // Once answered, the row stays but links to the circles page.
    await accept(t, "carol", inviteId);
    const [after] = await viewsOf(t, "carol");
    expect(after.href).toBe("/circles");
    expect(after.state).toBe("unavailable");
    expect(after.context.circleName).toBeUndefined();
  });

  for (const outcome of [
    "revoked",
    "declined",
    "expired",
    "blocked",
    "demoted",
  ] as const) {
    test(`once the invite is ${outcome}, the notification names no circle, shows unavailable and isn't delivered`, async () => {
      const t = convexTest(schema, modules);
      const { alice, carol, circleId } = await seed(t);
      await mutualFollow(t, alice, carol);
      const inviteId = await invite(t, "alice", circleId, carol);
      await flushScheduled(t);
      const deliver = () =>
        t.query(internal.notifications.resolveForDelivery.resolveForDelivery, {
          recipientId: carol,
          type: "circle_invite_received",
          relatedId: inviteId,
          actorId: alice,
          subject: { kind: "circleInvite", inviteId },
        });
      // While on offer, email/push carry the live circle name.
      expect((await deliver())?.params.circleName).toBe("Saturday Puzzlers");

      if (outcome === "revoked") await revoke(t, "alice", inviteId);
      else if (outcome === "declined") await decline(t, "carol", inviteId);
      else if (outcome === "expired") await backdate(t, inviteId);
      else if (outcome === "blocked") await block(t, alice, carol);
      else {
        // Demoted in the row directly, so the invite itself is still pending.
        await t.run(async (ctx) => {
          const row = await ctx.db
            .query("circles")
            .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
            .unique();
          await ctx.db.patch(row!._id, {
            memberships: row!.memberships.map((m) =>
              m.memberId === alice
                ? { ...m, permission: "ViewOnly" as const }
                : m,
            ),
          });
        });
      }

      const [view] = await viewsOf(t, "carol");
      expect(view.context.circleName).toBeUndefined();
      expect(view.state).toBe("unavailable");
      expect(view.href).toBe("/circles");
      expect(await deliver()).toBeNull();
      // The invitee's own list agrees.
      expect(
        await as(t, "carol").query(
          api.sharing.listMyCircleInvites.listMyCircleInvites,
          {},
        ),
      ).toEqual([]);
    });
  }

  test("accepting notifies the inviter (actor = invitee, circle subject)", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);
    await accept(t, "carol", inviteId);
    await flushScheduled(t);

    const rows = await notificationsOf(t, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "circle_invite_accepted",
      relatedId: circleId,
      actorIds: [carol],
      subject: { kind: "circle", circleId },
    });
    const [view] = await viewsOf(t, "alice");
    expect(view.context.circleName).toBe("Saturday Puzzlers");
    expect(view.href).toBe("/circles");
  });

  test("a private inviter who has since unfollowed is anonymous in the notification", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await invite(t, "alice", circleId, carol);
    await flushScheduled(t);
    await unfollow(t, alice, carol);

    const [view] = await viewsOf(t, "carol");
    expect(view.actors[0]).toEqual({ anonymous: true });
  });

  test("declining is silent: the inviter gets nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    const inviteId = await invite(t, "alice", circleId, carol);
    await decline(t, "carol", inviteId);
    await flushScheduled(t);

    expect(await notificationsOf(t, alice)).toEqual([]);
  });

  test("a block landing before dispatch suppresses the notification", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await invite(t, "alice", circleId, carol);
    await block(t, carol, alice);
    await flushScheduled(t);

    expect(await notificationsOf(t, carol)).toEqual([]);
  });

  test("circle_invite_received is email-eligible; circle_invite_accepted is in-app/push only", async () => {
    expect(EMAIL_ELIGIBLE_TYPES.has("circle_invite_received")).toBe(true);
    expect(EMAIL_ELIGIBLE_TYPES.has("circle_invite_accepted")).toBe(false);

    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await mutualFollow(t, alice, carol);
    await as(t, "carol").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "circle_invite_received", channel: "email", enabled: true },
    );
    await as(t, "alice").mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "circle_invite_accepted", channel: "email", enabled: true },
    );
    const inviteId = await invite(t, "alice", circleId, carol);
    await accept(t, "carol", inviteId);
    await flushScheduled(t);

    const emails = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    )
      .filter((job) => job.name.includes("sendEmail"))
      .map((job) => (job.args[0] as { type: string }).type);
    expect(emails).toEqual(["circle_invite_received"]);
  });
});
