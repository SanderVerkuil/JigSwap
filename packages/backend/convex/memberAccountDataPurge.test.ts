import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import schema from "./schema";

// Account deletion for what #247 left behind (#259): users.deleteUser schedules
// conversation/purgeMemberMessagingData, which now also deletes
//   - the member's own notification inbox, and no email or push still due goes out to them;
//   - their per-member settings and state (push subscriptions, notification and solving
//     preferences, favorites, profile, What's new state, onboarding);
//   - their invite redemptions both ways and their invite links (the counters on other members'
//     links are historic totals and stay);
//   - follow notifications naming them that the follow graph no longer leads to: a new_follower
//     row for someone they unfollowed, a follow_request_received for a request they cancelled.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave" | "erin" | "newbie";

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
  for (let i = 0; i < 400; i++) {
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

const follow = async (t: T, who: Who, followeeId: Id<"users">) => {
  await as(t, who).mutation(api.social.followMember.followMember, {
    followeeId,
  });
  await settleDueJobs(t);
};

const unfollow = async (t: T, who: Who, followeeId: Id<"users">) => {
  await as(t, who).mutation(api.social.unfollowMember.unfollowMember, {
    followeeId,
  });
  await settleDueJobs(t);
};

// The per-member settings and state rows, one (or a couple) of each.
const insertOwnRows = (t: T, memberId: Id<"users">, puzzleId: Id<"puzzles">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("pushSubscriptions", {
      userId: memberId,
      endpoint: `https://push.example/${memberId}`,
      p256dh: "key",
      auth: "secret",
      createdAt: now,
    });
    await ctx.db.insert("notificationPreferences", {
      memberId,
      toggles: {},
      updatedAt: now,
    });
    await ctx.db.insert("solvingPreferences", {
      memberId,
      shareInProgress: true,
      updatedAt: now,
    });
    await ctx.db.insert("favorites", {
      userId: memberId,
      puzzleId,
      createdAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId,
      displayName: "Shown name",
      bio: "About me",
      updatedAt: now,
    });
    await ctx.db.insert("whatsNewReadStates", {
      memberId,
      seenEntryIds: ["entry-1"],
      updatedAt: now,
    });
    for (const tourId of ["tour-a", "tour-b"]) {
      await ctx.db.insert("whatsNewTourProgress", {
        memberId,
        tourId,
        status: "completed",
        updatedAt: now,
      });
    }
    await ctx.db.insert("memberOnboarding", {
      memberId,
      skippedSteps: ["household"],
      updatedAt: now,
    });
  });

const OWN_TABLES = [
  ["pushSubscriptions", "userId"],
  ["notificationPreferences", "memberId"],
  ["solvingPreferences", "memberId"],
  ["favorites", "userId"],
  ["profiles", "memberId"],
  ["whatsNewReadStates", "memberId"],
  ["whatsNewTourProgress", "memberId"],
  ["memberOnboarding", "memberId"],
  ["notifications", "userId"],
] as const satisfies ReadonlyArray<readonly [TableNames, string]>;

// How many rows of each per-member table belong to the member.
const ownRowCounts = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    const out: Record<string, number> = {};
    for (const [table, field] of OWN_TABLES) {
      const rows = (await ctx.db.query(table).collect()) as Array<
        Record<string, unknown>
      >;
      out[table] = rows.filter((row) => row[field] === memberId).length;
    }
    return out;
  });

// Alice is the member who deletes her account.
//   own data      her settings and state rows; Bob's follow puts a new_follower in her inbox.
//   stale follow  she followed Dave and unfollowed him (his row names only her); Carol and then she
//                 followed Bob and she unfollowed him (his grouped row has her as newest actor);
//                 she asked to follow private Erin and cancelled (Erin's request row is gone).
//   redemptions   Newbie signed up through Alice's link; Alice and Carol through Bob's.
//   others        Bob holds the same settings rows; Carol's request to Erin is pending.
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
    const alice = await mk("alice");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return {
      alice,
      bob: await mk("bob"),
      carol: await mk("carol"),
      dave: await mk("dave"),
      erin: await mk("erin"),
      newbie: await mk("newbie"),
      puzzleId,
    };
  });
  await insertOwnRows(t, ids.alice, ids.puzzleId);
  await insertOwnRows(t, ids.bob, ids.puzzleId);

  await follow(t, "bob", ids.alice);

  await follow(t, "alice", ids.dave);
  await unfollow(t, "alice", ids.dave);
  await follow(t, "carol", ids.bob);
  await follow(t, "alice", ids.bob);
  await unfollow(t, "alice", ids.bob);

  await as(t, "erin").mutation(
    api.social.setProfileVisibility.setProfileVisibility,
    { visibility: "private" },
  );
  await follow(t, "alice", ids.erin);
  const request = await t.run((ctx) =>
    ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", ids.alice).eq("targetId", ids.erin),
      )
      .unique(),
  );
  await as(t, "alice").mutation(
    api.social.cancelFollowRequest.cancelFollowRequest,
    { requestId: request!.aggregateId },
  );
  await follow(t, "carol", ids.erin);

  const redeem = async (owner: Who, redeemer: Who) => {
    const { token } = await as(t, owner).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    await as(t, redeemer).mutation(api.social.redeemInvite.redeemInvite, {
      token,
    });
  };
  await redeem("alice", "newbie");
  await redeem("bob", "alice");
  await redeem("bob", "carol");
  await settleDueJobs(t);
  return ids;
};

const deleteAlice = async (t: T) => {
  await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
  await settleDueJobs(t);
};

const notificationsOf = (t: T, userId: Id<"users">, type: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((row) => row.type === type),
  );

// Every notification in someone else's inbox that names the member as an actor.
const notificationsNaming = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter(
      (row) =>
        row.userId !== memberId &&
        ((row.actorIds ?? []).includes(memberId) || row.relatedId === memberId),
    ),
  );

const redemptions = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("inviteRedemptions").collect()).map((row) => [
      row.inviterId,
      row.newMemberId,
    ]),
  );

const linksOf = (t: T, ownerId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect(),
  );

const ALL_OWN = {
  pushSubscriptions: 1,
  notificationPreferences: 1,
  solvingPreferences: 1,
  favorites: 1,
  profiles: 1,
  whatsNewReadStates: 1,
  whatsNewTourProgress: 2,
  memberOnboarding: 1,
};
const NONE_OWN = Object.fromEntries(
  OWN_TABLES.map(([table]) => [table, 0]),
) as Record<string, number>;

describe("account deletion: own data, invite redemptions, stale follow notifications", () => {
  test("the seed holds her own rows, redemptions both ways and stale follow notifications", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(await ownRowCounts(t, s.alice)).toMatchObject(ALL_OWN);
    expect(await notificationsOf(t, s.alice, "new_follower")).toHaveLength(1);
    expect(await redemptions(t)).toEqual(
      expect.arrayContaining([
        [s.alice, s.newbie],
        [s.bob, s.alice],
        [s.bob, s.carol],
      ]),
    );
    expect(await linksOf(t, s.alice)).toHaveLength(1);
    // No follow edge or request leads to these any more.
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("follows").collect()).filter(
          (row) => row.followerId === s.alice,
        ),
      ),
    ).toEqual([]);
    const [daveRow] = await notificationsOf(t, s.dave, "new_follower");
    expect(daveRow.actorIds).toEqual([s.alice]);
    const [bobRow] = await notificationsOf(t, s.bob, "new_follower");
    expect(bobRow.actorIds).toEqual([s.alice, s.carol]);
    expect(bobRow.actorCount).toBe(2);
    expect(
      (await notificationsOf(t, s.erin, "follow_request_received")).map(
        (n) => n.actorIds,
      ),
    ).toEqual(expect.arrayContaining([[s.alice], [s.carol]]));
  });

  test("her notification inbox is deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(
      await t.run((ctx) =>
        ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", s.alice))
          .collect(),
      ),
    ).toEqual([]);
  });

  test("an email or push still due for her is not sent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const deliver = () =>
      t.query(internal.notifications.resolveForDelivery.resolveForDelivery, {
        recipientId: s.alice,
        type: "new_follower",
        relatedId: s.bob,
        actorId: s.bob,
      });
    expect(await deliver()).not.toBeNull();

    await deleteAlice(t);

    expect(await deliver()).toBeNull();
    // Push has nowhere left to go either.
    expect(
      await t.query(
        internal.notifications.pushSubscriptions.listSubscriptionsForUser,
        { userId: s.alice },
      ),
    ).toEqual([]);
  });

  test("a tombstoned member gets no email or push either", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(s.alice, { isActive: false, email: undefined }),
    );

    expect(
      await t.query(
        internal.notifications.resolveForDelivery.resolveForDelivery,
        {
          recipientId: s.alice,
          type: "new_follower",
          relatedId: s.bob,
          actorId: s.bob,
        },
      ),
    ).toBeNull();
  });

  test("her settings and state rows are deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await ownRowCounts(t, s.alice)).toEqual(NONE_OWN);
  });

  test("her invite redemptions both ways and her invite links are deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await redemptions(t)).toEqual([[s.bob, s.carol]]);
    expect(await linksOf(t, s.alice)).toEqual([]);
  });

  test("the inviter's counters are historic totals and do not drop", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const [before] = await linksOf(t, s.bob);
    expect(before.signupsAttributed).toBe(2);

    await deleteAlice(t);

    const [after] = await linksOf(t, s.bob);
    expect(after.signupsAttributed).toBe(2);
    expect(after.followsEstablished).toBe(before.followsEstablished);
    expect(after.token).toBe(before.token);
  });

  test("a household link she used no longer names her, and stays used", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // A household link of Carol's that Alice redeemed (her network-link redemption is replaced,
    // since a member redeems one invite at most).
    const linkId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("inviteLinks", {
        ownerId: s.carol,
        token: "household-token",
        createdAt: now,
        landingViews: 1,
        signupsAttributed: 1,
        followsEstablished: 0,
        context: { kind: "household", householdId: "household-1" },
        expiresAt: now + 14 * 24 * 60 * 60 * 1000,
        consumedAt: now,
        consumedBy: s.alice,
      });
      const mine = await ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", s.alice))
        .unique();
      await ctx.db.patch(mine!._id, { inviteLinkId: id, inviterId: s.carol });
      return id;
    });

    await deleteAlice(t);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.consumedBy).toBeUndefined();
    expect(link?.consumedAt).toBeDefined();
    expect(link?.signupsAttributed).toBe(1);
  });

  test("a new_follower row for someone she unfollowed is deleted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await notificationsOf(t, s.dave, "new_follower")).toEqual([]);
  });

  test("a grouped new_follower row she was on after unfollowing keeps the others", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    const [bobRow, ...rest] = await notificationsOf(t, s.bob, "new_follower");
    expect(rest).toEqual([]);
    expect(bobRow.actorIds).toEqual([s.carol]);
    expect(bobRow.actorCount).toBe(1);
    expect(bobRow.relatedId).toBe(s.carol);
    expect(bobRow.params?.actorName).toBeUndefined();
  });

  test("a follow request she cancelled leaves no notification naming her", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(
      (await notificationsOf(t, s.erin, "follow_request_received")).map(
        (n) => n.actorIds,
      ),
    ).toEqual([[s.carol]]);
    expect(await notificationsNaming(t, s.alice)).toEqual([]);
  });

  test("other members' rows, redemptions, links and notifications are untouched", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const bobInbox = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", s.bob))
        .collect(),
    );
    await deleteAlice(t);

    expect(await ownRowCounts(t, s.bob)).toMatchObject(ALL_OWN);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", s.bob))
          .collect(),
      ),
    ).toHaveLength(bobInbox.length);
    expect(await linksOf(t, s.bob)).toHaveLength(1);
    expect(await redemptions(t)).toEqual([[s.bob, s.carol]]);
    // Newbie stays a member; only the attribution to Alice goes.
    expect(await t.run((ctx) => ctx.db.get(s.newbie))).not.toBeNull();
  });

  test("the purge completes with a batch size of 1", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, batchSize: 1 },
    );
    await settleDueJobs(t);

    expect(await ownRowCounts(t, s.alice)).toEqual(NONE_OWN);
    expect(await redemptions(t)).toEqual([[s.bob, s.carol]]);
    expect(await linksOf(t, s.alice)).toEqual([]);
    expect(await notificationsNaming(t, s.alice)).toEqual([]);
    expect(await ownRowCounts(t, s.bob)).toMatchObject(ALL_OWN);
  });
});
