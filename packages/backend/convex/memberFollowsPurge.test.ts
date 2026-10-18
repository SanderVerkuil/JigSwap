import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Account deletion for the follow graph (#243): users.deleteUser schedules
// conversation/purgeMemberMessagingData, which deletes every follow edge the member is on (people
// they followed and people who followed them) and every follow request they sent or received, of
// any status. The follow notifications naming them go with them: a new_follower row that names
// only them is deleted, a grouped one loses them from its actors; follow_request_received and
// follow_request_approved rows from them are deleted. Follower counts and "followers you know"
// are read live from `follows`, so the other party's numbers are right once the edges are gone.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave" | "erin";

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

const follow = async (t: T, who: Who, followeeId: Id<"users">) => {
  await as(t, who).mutation(api.social.followMember.followMember, {
    followeeId,
  });
  await settleDueJobs(t);
};

const makePrivate = async (t: T, who: Who) => {
  await as(t, who).mutation(
    api.social.setProfileVisibility.setProfileVisibility,
    { visibility: "private" },
  );
  await settleDueJobs(t);
};

// Alice is the member who deletes her account.
//   followed        Alice follows Bob (Dave too, so Bob's new_follower row groups both) and Carol.
//   requested       Erin is private: Alice's follow is a pending request.
//   followers       Alice goes private. Carol follows her (Alice follows Carol, so it is instant);
//                   Dave's request is approved by Alice.
//   requested her   Erin's follow of Alice is a pending request.
//   others          Bob follows Carol; Carol's request to Erin is pending.
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
      dave: await mk("dave"),
      erin: await mk("erin"),
    };
  });

  await follow(t, "alice", ids.bob);
  await follow(t, "dave", ids.bob);
  await follow(t, "alice", ids.carol);
  await makePrivate(t, "erin");
  await follow(t, "alice", ids.erin);

  await makePrivate(t, "alice");
  await follow(t, "carol", ids.alice);
  await follow(t, "dave", ids.alice);
  const daveRequest = await t.run(async (ctx) =>
    ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", ids.dave).eq("targetId", ids.alice),
      )
      .unique(),
  );
  await as(t, "alice").mutation(
    api.social.approveFollowRequest.approveFollowRequest,
    { requestId: daveRequest!.aggregateId },
  );
  await settleDueJobs(t);
  await follow(t, "erin", ids.alice);

  await follow(t, "bob", ids.carol);
  await follow(t, "carol", ids.erin);
  return ids;
};

type Seeded = Awaited<ReturnType<typeof seed>>;

const deleteAlice = async (t: T) => {
  await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
  await settleDueJobs(t);
};

const edgesOf = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("follows").collect()).filter(
      (row) => row.followerId === memberId || row.followeeId === memberId,
    ),
  );

const requestsOf = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("followRequests").collect()).filter(
      (row) => row.requesterId === memberId || row.targetId === memberId,
    ),
  );

const FOLLOW_TYPES = [
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
];

// Every follow notification in someone else's inbox that still names the member.
const followNotificationsNaming = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter(
      (row) =>
        row.userId !== memberId &&
        FOLLOW_TYPES.includes(row.type) &&
        ((row.actorIds ?? []).includes(memberId) || row.relatedId === memberId),
    ),
  );

const notificationsOf = (t: T, userId: Id<"users">, type: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((row) => row.type === type),
  );

const counts = async (t: T, viewer: Who, handle: Who) => {
  const profile = await as(t, viewer).query(
    api.social.getPublicProfile.getPublicProfile,
    { handle },
  );
  return {
    followers: profile!.hero.followerCount,
    following: profile!.hero.followingCount,
  };
};

const pairs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("follows").collect()).map((row) => [
      row.followerId,
      row.followeeId,
    ]),
  );

describe("account deletion: follow edges and follow requests", () => {
  test("the seed holds edges and requests both ways, each notified", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // alice->bob, alice->carol, carol->alice, dave->alice.
    expect(await edgesOf(t, s.alice)).toHaveLength(4);
    // alice->erin pending, dave->alice approved, erin->alice pending.
    expect(
      (await requestsOf(t, s.alice)).map((r) => [
        r.requesterId,
        r.targetId,
        r.status,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [s.alice, s.erin, "pending"],
        [s.dave, s.alice, "approved"],
        [s.erin, s.alice, "pending"],
      ]),
    );
    const [bobRow] = await notificationsOf(t, s.bob, "new_follower");
    expect(bobRow.actorIds).toEqual([s.dave, s.alice]);
    expect(bobRow.actorCount).toBe(2);
    expect(
      (await followNotificationsNaming(t, s.alice)).map((n) => [
        n.userId,
        n.type,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [s.bob, "new_follower"],
        [s.carol, "new_follower"],
        [s.erin, "follow_request_received"],
        [s.dave, "follow_request_approved"],
      ]),
    );
    expect(await counts(t, "carol", "bob")).toEqual({
      followers: 2,
      following: 1,
    });
    expect(
      (
        await as(t, "dave").query(
          api.social.followersYouKnow.followersYouKnow,
          {
            memberId: s.bob,
          },
        )
      ).total,
    ).toBe(1);
  });

  test("the people she followed and who followed her are no longer linked to her", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await edgesOf(t, s.alice)).toEqual([]);
  });

  test("the follow requests she sent and received are deleted, whatever their status", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await requestsOf(t, s.alice)).toEqual([]);
    expect(
      (
        await as(t, "erin").query(
          api.social.listIncomingFollowRequests.listIncomingFollowRequests,
          {},
        )
      ).map((r) => r.requestId),
    ).toHaveLength(1);
  });

  test("the other party's follower and following counts drop", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await deleteAlice(t);

    expect(await counts(t, "carol", "bob")).toEqual({
      followers: 1,
      following: 1,
    });
    expect(await counts(t, "bob", "carol")).toEqual({
      followers: 1,
      following: 0,
    });
    expect(await counts(t, "bob", "dave")).toEqual({
      followers: 0,
      following: 1,
    });
  });

  test("she no longer appears in followers you know", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(
      await as(t, "dave").query(api.social.followersYouKnow.followersYouKnow, {
        memberId: s.bob,
      }),
    ).toEqual({ total: 0, members: [] });
  });

  test("no follow notification in anyone else's inbox names her", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await followNotificationsNaming(t, s.alice)).toEqual([]);
    expect(await notificationsOf(t, s.dave, "follow_request_approved")).toEqual(
      [],
    );
  });

  test("a grouped new_follower row keeps the other followers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    const [bobRow, ...rest] = await notificationsOf(t, s.bob, "new_follower");
    expect(rest).toEqual([]);
    expect(bobRow.actorIds).toEqual([s.dave]);
    expect(bobRow.actorCount).toBe(1);
  });

  test("a grouped new_follower row she was newest on no longer carries her name", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // Alice unfollows Bob and follows him again, so she is the newest actor on his group.
    await as(t, "alice").mutation(api.social.unfollowMember.unfollowMember, {
      followeeId: s.bob,
    });
    await follow(t, "alice", s.bob);
    const [before] = await notificationsOf(t, s.bob, "new_follower");
    expect(before.actorIds?.[0]).toBe(s.alice);
    expect(before.relatedId).toBe(s.alice);
    expect(before.params?.actorName).toBe("Alice");

    await deleteAlice(t);

    const [after] = await notificationsOf(t, s.bob, "new_follower");
    expect(after.actorIds).toEqual([s.dave]);
    expect(after.relatedId).toBe(s.dave);
    expect(after.params?.actorName).toBeUndefined();
  });

  test("other members' edges, requests and notifications are untouched", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await deleteAlice(t);

    expect(await pairs(t)).toEqual(
      expect.arrayContaining([
        [s.dave, s.bob],
        [s.bob, s.carol],
      ]),
    );
    expect(await pairs(t)).toHaveLength(2);
    expect(
      (await t.run((ctx) => ctx.db.query("followRequests").collect())).map(
        (r) => [r.requesterId, r.targetId, r.status],
      ),
    ).toEqual([[s.carol, s.erin, "pending"]]);
    expect(
      (await notificationsOf(t, s.erin, "follow_request_received")).map(
        (n) => n.actorIds,
      ),
    ).toEqual([[s.carol]]);
    // Carol's group (Bob, then Alice) keeps Bob.
    expect(
      (await notificationsOf(t, s.carol, "new_follower")).map(
        (n) => n.actorIds,
      ),
    ).toEqual([[s.bob]]);
  });

  test("the purge completes with a batch size of 1", async () => {
    const t = convexTest(schema, modules);
    const s: Seeded = await seed(t);
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, batchSize: 1 },
    );
    await settleDueJobs(t);

    expect(await edgesOf(t, s.alice)).toEqual([]);
    expect(await requestsOf(t, s.alice)).toEqual([]);
    expect(await followNotificationsNaming(t, s.alice)).toEqual([]);
    expect(await pairs(t)).toHaveLength(2);
  });
});
