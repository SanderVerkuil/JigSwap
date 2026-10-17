import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// notifications.act: one inline action on one of the caller's notifications. Rows are seeded
// directly with the refs N2's subscriber writes (household invites go through the real mutations,
// since accepting needs a real household). Each test pins one rule: delegation per action, ownership,
// staleness against the live view, the private-target follow request, grouped rows, mark-read.

type T = TestConvex<typeof schema>;
type NotificationInsert = Omit<
  Doc<"notifications">,
  "_id" | "_creationTime" | "userId" | "isRead" | "createdAt" | "aggregateId"
>;

const now = Date.now();

const mkUser = (ctx: MutationCtx, clerkId: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: `${clerkId} name`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

const follow = (
  ctx: MutationCtx,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) => ctx.db.insert("follows", { followerId, followeeId, createdAt: now });

const request = (
  ctx: MutationCtx,
  aggregateId: string,
  requesterId: Id<"users">,
  targetId: Id<"users">,
  status: "pending" | "approved" | "declined" = "pending",
) =>
  ctx.db.insert("followRequests", {
    aggregateId,
    requesterId,
    targetId,
    status,
    createdAt: now,
  });

let seq = 0;
const notify = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  row: NotificationInsert,
): Promise<string> => {
  seq += 1;
  const aggregateId = `act-notif-${seq}`;
  await ctx.db.insert("notifications", {
    aggregateId,
    channel: "inApp",
    isRead: false,
    createdAt: now + seq,
    ...row,
    userId,
  });
  return aggregateId;
};

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const viewer = await mkUser(ctx, "viewer");
    const mara = await mkUser(ctx, "mara");
    const priv = await mkUser(ctx, "priv");
    const other = await mkUser(ctx, "other");
    await ctx.db.insert("profiles", {
      memberId: priv,
      visibility: "private",
      displayName: "Priv",
      updatedAt: now,
    });
    return { viewer, mara, priv, other };
  });
  return { t, ...ids };
};

const as = (t: T, who: string) => t.withIdentity({ subject: who });

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const errorDataOf = async (
  p: Promise<unknown>,
): Promise<Record<string, unknown>> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    const data = (e as ConvexError<Value>).data;
    return typeof data === "string"
      ? (JSON.parse(data) as Record<string, unknown>)
      : (data as Record<string, unknown>);
  }
  throw new Error("expected the call to reject");
};

const act = (t: T, notificationId: string, action: string) =>
  as(t, "viewer").mutation(api.notifications.act.act, {
    notificationId,
    action: action as "follow_back",
  });

const rowOf = (t: T, aggregateId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const hasEdge = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run(async (ctx) => {
    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", followerId).eq("followeeId", followeeId),
      )
      .first();
    return edge !== null;
  });

const requestOf = (t: T, aggregateId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const followRequestRow = (
  ctx: MutationCtx,
  viewer: Id<"users">,
  requester: Id<"users">,
  requestId: string,
) =>
  notify(ctx, viewer, {
    type: "follow_request_received",
    actorIds: [requester],
    actorCount: 1,
    subject: { kind: "followRequest", requestId },
  });

describe("notifications.act: follow back", () => {
  test("new_follower from a member who follows the viewer: follows back, resolves following_each_other, marks read", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, mara, viewer);
      return notify(ctx, viewer, {
        type: "new_follower",
        actorIds: [mara],
        actorCount: 1,
      });
    });

    expect(await act(t, id, "follow_back")).toEqual({
      resolvedAs: "following_each_other",
    });
    expect(await hasEdge(t, viewer, mara)).toBe(true);
    expect((await rowOf(t, id))?.isRead).toBe(true);
    await flushScheduled(t);
  });

  test("new_follower from a private member who follows the viewer: the reverse edge makes it an instant follow", async () => {
    const { t, viewer, priv } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, priv, viewer);
      return notify(ctx, viewer, {
        type: "new_follower",
        actorIds: [priv],
        actorCount: 1,
      });
    });

    expect(await act(t, id, "follow_back")).toEqual({
      resolvedAs: "following_each_other",
    });
    expect(await hasEdge(t, viewer, priv)).toBe(true);
    await flushScheduled(t);
  });

  test("follow_back toward a private actor who does not follow the viewer sends a request: requested", async () => {
    const { t, viewer, priv } = await setup();
    const id = await t.run((ctx) =>
      notify(ctx, viewer, {
        type: "follow_request_approved",
        actorIds: [priv],
        actorCount: 1,
      }),
    );

    expect(await act(t, id, "follow_back")).toEqual({
      resolvedAs: "requested",
    });
    expect(await hasEdge(t, viewer, priv)).toBe(false);
    const requests = await t.run((ctx) =>
      ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q.eq("requesterId", viewer).eq("targetId", priv),
        )
        .collect(),
    );
    expect(requests.map((r) => r.status)).toEqual(["pending"]);
    expect((await rowOf(t, id))?.isRead).toBe(true);
    await flushScheduled(t);
  });

  test("follow_back toward a public actor who does not follow the viewer: following", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run((ctx) =>
      notify(ctx, viewer, {
        type: "follow_request_approved",
        actorIds: [mara],
        actorCount: 1,
      }),
    );

    expect(await act(t, id, "follow_back")).toEqual({
      resolvedAs: "following",
    });
    expect(await hasEdge(t, viewer, mara)).toBe(true);
    await flushScheduled(t);
  });

  test("already following: stale with following_each_other, nothing written, row stays unread", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, mara, viewer);
      await follow(ctx, viewer, mara);
      return notify(ctx, viewer, {
        type: "new_follower",
        actorIds: [mara],
        actorCount: 1,
      });
    });

    expect(await errorDataOf(act(t, id, "follow_back"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "following_each_other",
    });
    expect((await rowOf(t, id))?.isRead).toBe(false);
  });

  test("already requested: stale with requested", async () => {
    const { t, viewer, priv } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-viewer-priv", viewer, priv);
      return notify(ctx, viewer, {
        type: "follow_request_approved",
        actorIds: [priv],
        actorCount: 1,
      });
    });

    expect(await errorDataOf(act(t, id, "follow_back"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "requested",
    });
  });

  test("a grouped row (actorCount > 1) offers no inline action: stale without resolvedAs", async () => {
    const { t, viewer, mara, other } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, mara, viewer);
      await follow(ctx, other, viewer);
      return notify(ctx, viewer, {
        type: "new_follower",
        actorIds: [mara, other],
        actorCount: 2,
      });
    });

    expect(await errorDataOf(act(t, id, "follow_back"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
    });
    expect(await hasEdge(t, viewer, mara)).toBe(false);
  });
});

describe("notifications.act: follow requests", () => {
  test("approve: creates the requester's edge, approves the request, resolves approved, marks read", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });

    expect(await act(t, id, "approve_follow_request")).toEqual({
      resolvedAs: "approved",
    });
    expect((await requestOf(t, "req-1"))?.status).toBe("approved");
    expect(await hasEdge(t, mara, viewer)).toBe(true);
    expect(await hasEdge(t, viewer, mara)).toBe(false);
    expect((await rowOf(t, id))?.isRead).toBe(true);
    await flushScheduled(t);
  });

  test("approve and follow back: both edges, toward a private requester too", async () => {
    const { t, viewer, priv } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", priv, viewer);
      return followRequestRow(ctx, viewer, priv, "req-1");
    });

    expect(await act(t, id, "approve_and_follow_back")).toEqual({
      resolvedAs: "approved",
    });
    expect((await requestOf(t, "req-1"))?.status).toBe("approved");
    expect(await hasEdge(t, priv, viewer)).toBe(true);
    expect(await hasEdge(t, viewer, priv)).toBe(true);
    await flushScheduled(t);
  });

  test("decline: declines the request, no edges, resolves declined, marks read", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });

    expect(await act(t, id, "decline_follow_request")).toEqual({
      resolvedAs: "declined",
    });
    expect((await requestOf(t, "req-1"))?.status).toBe("declined");
    expect(await hasEdge(t, mara, viewer)).toBe(false);
    expect((await rowOf(t, id))?.isRead).toBe(true);
    await flushScheduled(t);
  });

  test("a stored request id that no longer exists falls back to the pair's current request", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-new", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-old");
    });

    expect(await act(t, id, "approve_follow_request")).toEqual({
      resolvedAs: "approved",
    });
    expect((await requestOf(t, "req-new"))?.status).toBe("approved");
    await flushScheduled(t);
  });

  test("an old declined request plus a newer pending one for the pair: the view offers approve and act approves the pending one", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      // The old declined row is inserted first, so a plain index .first() would return it.
      await ctx.db.insert("followRequests", {
        aggregateId: "req-old",
        requesterId: mara,
        targetId: viewer,
        status: "declined",
        createdAt: now - 10_000,
        respondedAt: now - 9_000,
      });
      await request(ctx, "req-new", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-gone");
    });

    const page = await as(t, "viewer").query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    const view = page.page.find((v) => v.id === id);
    expect(view?.state).toBe("actionable");
    expect(view?.availableActions).toContain("approve_follow_request");

    expect(await act(t, id, "approve_follow_request")).toEqual({
      resolvedAs: "approved",
    });
    expect((await requestOf(t, "req-new"))?.status).toBe("approved");
    expect((await requestOf(t, "req-old"))?.status).toBe("declined");
    await flushScheduled(t);
  });

  test("a stored request id pointing at someone else's request is ignored for the actor -> viewer pair", async () => {
    const { t, viewer, mara, other } = await setup();
    const id = await t.run(async (ctx) => {
      // The stored id names other -> viewer; the row's actor is mara.
      await request(ctx, "req-other", other, viewer);
      await request(ctx, "req-mara", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-other");
    });

    await act(t, id, "decline_follow_request");
    expect((await requestOf(t, "req-mara"))?.status).toBe("declined");
    expect((await requestOf(t, "req-other"))?.status).toBe("pending");
    await flushScheduled(t);
  });

  test("approved elsewhere: stale with approved", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });
    await as(t, "viewer").mutation(
      api.social.approveFollowRequest.approveFollowRequest,
      { requestId: "req-1" },
    );

    expect(await errorDataOf(act(t, id, "approve_follow_request"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "approved",
    });
    await flushScheduled(t);
  });

  test("declined elsewhere: stale with declined", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });
    await as(t, "viewer").mutation(
      api.social.declineFollowRequest.declineFollowRequest,
      { requestId: "req-1" },
    );

    expect(await errorDataOf(act(t, id, "approve_and_follow_back"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "declined",
    });
    expect(await hasEdge(t, mara, viewer)).toBe(false);
    await flushScheduled(t);
  });

  test("withdrawn by the requester: stale with expired", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });
    await as(t, "mara").mutation(
      api.social.cancelFollowRequest.cancelFollowRequest,
      { requestId: "req-1" },
    );

    expect(await errorDataOf(act(t, id, "decline_follow_request"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "expired",
    });
    await flushScheduled(t);
  });
});

describe("notifications.act: household invites", () => {
  // Mara founds a household and invites the viewer; returns the viewer's invite notification id.
  const maraInvitesViewer = async (t: T, viewer: Id<"users">) => {
    await as(t, "mara").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const inviteId = await as(t, "mara").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: viewer },
    );
    await flushScheduled(t);
    const row = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", viewer))
        .filter((q) => q.eq(q.field("type"), "household_invite_received"))
        .first(),
    );
    expect(row?.subject).toEqual({ kind: "householdInvite", inviteId });
    return { inviteId, id: row?.aggregateId as string };
  };

  const inviteStatus = (t: T, inviteId: string) =>
    t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("householdInvites")
            .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteId))
            .unique()
        )?.status,
    );

  test("accept: joins the household, resolves joined, marks read", async () => {
    const { t, viewer } = await setup();
    const { inviteId, id } = await maraInvitesViewer(t, viewer);

    expect(await act(t, id, "accept_household_invite")).toEqual({
      resolvedAs: "joined",
    });
    expect(await inviteStatus(t, inviteId)).toBe("accepted");
    const household = await as(t, "viewer").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(household).not.toBeNull();
    expect((await rowOf(t, id))?.isRead).toBe(true);
    await flushScheduled(t);
  });

  test("decline: declines the invite, resolves declined", async () => {
    const { t, viewer } = await setup();
    const { inviteId, id } = await maraInvitesViewer(t, viewer);

    expect(await act(t, id, "decline_household_invite")).toEqual({
      resolvedAs: "declined",
    });
    expect(await inviteStatus(t, inviteId)).toBe("declined");
    await flushScheduled(t);
  });

  test("accepted elsewhere: stale with joined", async () => {
    const { t, viewer } = await setup();
    const { inviteId, id } = await maraInvitesViewer(t, viewer);
    await as(t, "viewer").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );

    expect(await errorDataOf(act(t, id, "decline_household_invite"))).toEqual({
      code: "NOTIFICATION_ACTION_STALE",
      resolvedAs: "joined",
    });
    expect(await inviteStatus(t, inviteId)).toBe("accepted");
    await flushScheduled(t);
  });

  test("an action of another type is stale (accept on a follow request row)", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await request(ctx, "req-1", mara, viewer);
      return followRequestRow(ctx, viewer, mara, "req-1");
    });

    expect(
      (await errorDataOf(act(t, id, "accept_household_invite"))).code,
    ).toBe("NOTIFICATION_ACTION_STALE");
    expect((await requestOf(t, "req-1"))?.status).toBe("pending");
  });
});

describe("notifications.act: authorization", () => {
  test("someone else's notification reads exactly like an unknown id, and nothing happens", async () => {
    const { t, viewer, mara, other } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, mara, other);
      return notify(ctx, other, {
        type: "new_follower",
        actorIds: [mara],
        actorCount: 1,
      });
    });

    const wrongOwner = await errorDataOf(act(t, id, "follow_back"));
    const unknown = await errorDataOf(act(t, "no-such-id", "follow_back"));
    expect(wrongOwner.code).toBe("NotificationNotFound");
    expect(unknown.code).toBe("NotificationNotFound");
    expect(Object.keys(wrongOwner).sort()).toEqual(Object.keys(unknown).sort());
    expect(await hasEdge(t, viewer, mara)).toBe(false);
    expect((await rowOf(t, id))?.isRead).toBe(false);
  });

  test("unauthenticated callers are rejected", async () => {
    const { t, viewer, mara } = await setup();
    const id = await t.run(async (ctx) => {
      await follow(ctx, mara, viewer);
      return notify(ctx, viewer, {
        type: "new_follower",
        actorIds: [mara],
        actorCount: 1,
      });
    });

    await expect(
      t.mutation(api.notifications.act.act, {
        notificationId: id,
        action: "follow_back",
      }),
    ).rejects.toThrow();
    expect(await hasEdge(t, viewer, mara)).toBe(false);
  });

  test("reply_message is not an act action (validator rejects it)", async () => {
    const { t, viewer } = await setup();
    const id = await t.run((ctx) =>
      notify(ctx, viewer, { type: "message_received" }),
    );

    await expect(act(t, id, "reply_message")).rejects.toThrow();
  });
});
