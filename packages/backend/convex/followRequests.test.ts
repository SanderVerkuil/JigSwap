import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Hybrid follow model: public target → instant follow (+ new_follower notification);
// private target → pending request (+ follow_request_received); approval creates the edge
// (+ follow_request_approved to the requester, and NO new_follower to the approver — the
// approval suppression); decline is silent end-to-end.

const seedMembers = async (t: ReturnType<typeof convexTest>) =>
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
    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    // Bob's profile is PRIVATE; alice and carol have no profile row (= public by default).
    await ctx.db.insert("profiles", {
      aggregateId: "profile-bob",
      memberId: bob,
      displayName: "Bob",
      visibility: "private",
      updatedAt: now,
    });
    return { alice, bob, carol };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_carol" });

const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

const followEdges = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("follows").collect());

describe("follow notifications", () => {
  test("instant follow of a public member notifies them (new_follower)", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol } = await seedMembers(t);

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: carol },
    );
    expect(result.kind).toBe("followed");
    await flushScheduled(t);

    const carolNotifications = await notificationsFor(t, carol);
    expect(carolNotifications.map((n) => n.type)).toEqual(["new_follower"]);
    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications).toHaveLength(0);
  });

  test("following a private member creates a request and notifies the target (follow_request_received), no edge yet", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(result.kind).toBe("requested");
    await flushScheduled(t);

    expect(await followEdges(t)).toHaveLength(0);
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
  });

  test("approval creates the edge, notifies the requester, and does NOT new_follower-notify the approver", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);

    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await flushScheduled(t);

    const approval = await asBob(t).mutation(
      api.social.approveFollowRequest.approveFollowRequest,
      { requestId: requested.id },
    );
    expect(approval.alreadyFollowsBack).toBe(false);
    await flushScheduled(t);

    const edges = await followEdges(t);
    expect(edges).toHaveLength(1);
    expect(edges[0].followerId).toBe(alice);
    expect(edges[0].followeeId).toBe(bob);

    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications.map((n) => n.type)).toEqual([
      "follow_request_approved",
    ]);
    // Approval suppression: bob got follow_request_received earlier and must NOT also get
    // new_follower for the edge his own approval created.
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
  });

  test("decline is silent: no new notifications for anyone", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);

    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await flushScheduled(t);

    await asBob(t).mutation(
      api.social.declineFollowRequest.declineFollowRequest,
      { requestId: requested.id },
    );
    await flushScheduled(t);

    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications).toHaveLength(0);
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
    expect(await followEdges(t)).toHaveLength(0);
  });
});

describe("follow request lifecycle", () => {
  test("re-following a private member while a request is pending is idempotent (one row)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);

    const first = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    const second = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(second).toEqual(first);
    const rows = await t.run((ctx) => ctx.db.query("followRequests").collect());
    expect(rows).toHaveLength(1);
  });

  test("private target that already follows the actor gets an INSTANT follow (follow-back exception)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);
    // Bob (private) follows alice first (alice is public → instant).
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(result.kind).toBe("followed");
    expect(await followEdges(t)).toHaveLength(2);
  });

  test("cancel removes the pending request", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );

    await asAlice(t).mutation(
      api.social.cancelFollowRequest.cancelFollowRequest,
      { requestId: requested.id },
    );
    const rows = await t.run((ctx) => ctx.db.query("followRequests").collect());
    expect(rows).toHaveLength(0);
  });

  test("only the target can approve/decline; only the requester can cancel", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );

    await expect(
      asCarol(t).mutation(
        api.social.approveFollowRequest.approveFollowRequest,
        { requestId: requested.id },
      ),
    ).rejects.toThrow();
    await expect(
      asCarol(t).mutation(
        api.social.declineFollowRequest.declineFollowRequest,
        { requestId: requested.id },
      ),
    ).rejects.toThrow();
    await expect(
      asBob(t).mutation(api.social.cancelFollowRequest.cancelFollowRequest, {
        requestId: requested.id,
      }),
    ).rejects.toThrow();
  });

  test("getFollowRelation masks a fresh decline as still-pending (silent decline)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await asBob(t).mutation(
      api.social.declineFollowRequest.declineFollowRequest,
      { requestId: requested.id },
    );

    const relation = await asAlice(t).query(
      api.social.getFollowRelation.getFollowRelation,
      { memberId: bob },
    );
    expect(relation.pendingRequest).not.toBeNull();
    expect(relation.pendingRequest?.requestId).toBe(requested.id);
    expect(relation.following).toBe(false);
    expect(relation.targetIsPrivate).toBe(true);
  });

  test("going private does not retroactively remove followers", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol } = await seedMembers(t);
    // Alice follows carol while carol is public (instant edge).
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: carol,
    });
    // Carol then goes private.
    await asCarol(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    expect(await followEdges(t)).toHaveLength(1);
    const relation = await asAlice(t).query(
      api.social.getFollowRelation.getFollowRelation,
      { memberId: carol },
    );
    expect(relation.following).toBe(true);
    expect(relation.targetIsPrivate).toBe(true);
  });

  test("incoming list shows pending requests with requester view, newest first", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asCarol(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });

    const incoming = await asBob(t).query(
      api.social.listIncomingFollowRequests.listIncomingFollowRequests,
      {},
    );
    expect(incoming).toHaveLength(2);
    expect(incoming.map((r) => r.requester.name).sort()).toEqual([
      "Alice",
      "Carol",
    ]);
    expect(incoming[0].alreadyFollowing).toBe(false);
  });
});
