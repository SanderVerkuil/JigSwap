import type { NotificationView } from "@jigswap/contracts";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// notifications.listMyNotificationViews: the resolved read model. Rows are seeded directly with the
// refs N2's subscriber writes, so each test pins one resolution rule: actor privacy, live state and
// actions, unavailable targets, admin re-check, legacy rows, pagination and ownership.

type NotificationInsert = Omit<
  Doc<"notifications">,
  "_id" | "_creationTime" | "userId" | "isRead" | "createdAt"
> & { isRead?: boolean; createdAt?: number };

const now = Date.now();

const mkUser = (
  ctx: MutationCtx,
  clerkId: string,
  extra: Partial<Doc<"users">> = {},
) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: `${clerkId} name`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

const setVisibility = (
  ctx: MutationCtx,
  memberId: Id<"users">,
  visibility: "public" | "private",
  displayName?: string,
) =>
  ctx.db.insert("profiles", {
    memberId,
    visibility,
    ...(displayName ? { displayName } : {}),
    updatedAt: now,
  });

const follow = (
  ctx: MutationCtx,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) => ctx.db.insert("follows", { followerId, followeeId, createdAt: now });

let seq = 0;
const notify = (
  ctx: MutationCtx,
  userId: Id<"users">,
  row: NotificationInsert,
) => {
  seq += 1;
  return ctx.db.insert("notifications", {
    aggregateId: `notif-${seq}`,
    channel: "inApp",
    isRead: false,
    createdAt: now + seq,
    ...row,
    userId,
  });
};

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    viewer: await mkUser(ctx, "viewer"),
    mara: await mkUser(ctx, "mara", {
      username: "mara_u",
      avatar: "https://img/mara.png",
    }),
    priv: await mkUser(ctx, "priv", { slug: "priv-slug" }),
    other: await mkUser(ctx, "other"),
  }));
  await t.run(async (ctx) => {
    await setVisibility(ctx, ids.mara, "public", "Mara Display");
    await setVisibility(ctx, ids.priv, "private");
  });
  return { t, ...ids };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const viewsAs = async (
  s: Setup,
  clerkId = "viewer",
  numItems = 30,
  admin = false,
): Promise<NotificationView[]> => {
  const res = await s.t
    .withIdentity({
      subject: clerkId,
      ...(admin ? { metadata: { role: "admin" } } : {}),
    })
    .query(api.notifications.listMyNotificationViews.listMyNotificationViews, {
      paginationOpts: { numItems, cursor: null },
    });
  return res.page;
};

const onlyView = async (s: Setup, admin = false) => {
  const page = await viewsAs(s, "viewer", 30, admin);
  expect(page).toHaveLength(1);
  return page[0]!;
};

describe("auth", () => {
  test("requires a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 30, cursor: null } },
      ),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("never returns another member's notifications", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await notify(ctx, s.other, { type: "goal_achieved" });
      await notify(ctx, s.viewer, { type: "whats_new" });
    });
    const page = await viewsAs(s);
    expect(page.map((v) => v.type)).toEqual(["whats_new"]);
  });
});

describe("actor privacy", () => {
  test("a public actor is named via the profile display name, with handle and avatar", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await follow(ctx, s.mara, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.mara],
        actorCount: 1,
      });
    });
    const view = await onlyView(s);
    expect(view.actors).toEqual([
      {
        anonymous: false,
        memberId: s.mara,
        name: "Mara Display",
        avatar: "https://img/mara.png",
        handle: "mara_u",
      },
    ]);
    expect(view.href).toBe("/members/mara_u");
  });

  test("a private, non-mutual initiator is still named (slug handle)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await follow(ctx, s.priv, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.priv],
        actorCount: 1,
      });
    });
    const view = await onlyView(s);
    expect(view.actors[0]).toMatchObject({
      anonymous: false,
      memberId: s.priv,
      name: "priv name",
      handle: "priv-slug",
    });
  });

  test("a private, non-mutual actor on a non-initiator type is hidden; mutual reveals", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await notify(ctx, s.viewer, {
        type: "goal_achieved",
        actorIds: [s.priv],
        actorCount: 1,
      });
    });
    expect((await onlyView(s)).actors).toEqual([{ anonymous: true }]);

    await s.t.run(async (ctx) => {
      await follow(ctx, s.priv, s.viewer);
      await follow(ctx, s.viewer, s.priv);
    });
    expect((await onlyView(s)).actors[0]).toMatchObject({
      anonymous: false,
      memberId: s.priv,
    });
  });

  test("a deleted actor is anonymous and departed; their follow row has no link or actions", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await follow(ctx, s.other, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.other],
        actorCount: 1,
      });
      await ctx.db.delete(s.other);
    });
    const view = await onlyView(s);
    expect(view.actors).toEqual([{ anonymous: true, departed: true }]);
    expect(view.href).toBeNull();
    expect(view.state).toBe("unavailable");
    expect(view.availableActions).toEqual([]);
  });

  test("a deactivated actor is anonymous and departed", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.mara, { isActive: false });
      await notify(ctx, s.viewer, {
        type: "trade_request",
        actorIds: [s.mara],
        actorCount: 1,
      });
    });
    expect((await onlyView(s)).actors).toEqual([
      { anonymous: true, departed: true },
    ]);
  });

  test("no email appears anywhere in the payload", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      // An actor with nothing but an email still never falls back to it.
      const bare = await ctx.db.insert("users", {
        clerkId: "bare",
        email: "bare@example.com",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [bare],
        actorCount: 1,
      });
      await notify(ctx, s.viewer, {
        type: "follow_request_received",
        actorIds: [s.priv],
        actorCount: 1,
        subject: { kind: "followRequest", requestId: "none" },
      });
      await notify(ctx, s.viewer, {
        type: "trade_request",
        actorIds: [s.mara],
        actorCount: 1,
      });
    });
    const page = await viewsAs(s);
    expect(page).toHaveLength(3);
    expect(JSON.stringify(page)).not.toMatch(/@example\.com/);
    const bareView = page.find((v) => v.type === "new_follower")!;
    expect(bareView.actors[0]).not.toHaveProperty("name");
  });
});

describe("new_follower / follow_request_approved live state", () => {
  const seedNewFollower = (s: Setup, actor: Id<"users">) =>
    s.t.run(async (ctx) => {
      await follow(ctx, actor, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [actor],
        actorCount: 1,
      });
    });

  test("offers follow back while the viewer does not follow the follower", async () => {
    const s = await setup();
    await seedNewFollower(s, s.mara);
    const view = await onlyView(s);
    expect(view.state).toBe("actionable");
    expect(view.availableActions).toEqual(["follow_back"]);
  });

  test("already following each other resolves", async () => {
    const s = await setup();
    await seedNewFollower(s, s.mara);
    await s.t.run((ctx) => follow(ctx, s.viewer, s.mara));
    const view = await onlyView(s);
    expect(view.state).toBe("resolved");
    expect(view.resolvedAs).toBe("following_each_other");
    expect(view.availableActions).toEqual([]);
  });

  test("a private follower with a pending viewer request resolves as requested", async () => {
    const s = await setup();
    await seedNewFollower(s, s.priv);
    await s.t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: "req-back",
        requesterId: s.viewer,
        targetId: s.priv,
        status: "pending",
        createdAt: now,
      }),
    );
    const view = await onlyView(s);
    expect(view.resolvedAs).toBe("requested");
  });

  test("grouped rows never offer actions and link to /people", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await follow(ctx, s.mara, s.viewer);
      await follow(ctx, s.priv, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.mara, s.priv],
        actorCount: 5,
        updatedAt: now + 10_000,
      });
    });
    const view = await onlyView(s);
    expect(view.actorCount).toBe(5);
    expect(view.actors).toHaveLength(2);
    expect(view.state).toBe("informational");
    expect(view.availableActions).toEqual([]);
    expect(view.href).toBe("/people");
    expect(view.createdAt).toBe(now + 10_000);
  });

  test("marking a grouped row read keeps all of its actors", async () => {
    const s = await setup();
    const rowId = await s.t.run((ctx) =>
      notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.mara, s.priv],
        actorCount: 5,
        groupKey: "new_follower",
        updatedAt: now + 10_000,
      }),
    );
    const view = await onlyView(s);
    await s.t
      .withIdentity({ subject: "viewer" })
      .mutation(api.notifications.markNotificationRead.markNotificationRead, {
        notificationId: view.id,
      });
    const row = await s.t.run((ctx) => ctx.db.get(rowId));
    expect(row).toMatchObject({
      isRead: true,
      actorIds: [s.mara, s.priv],
      actorCount: 5,
      groupKey: "new_follower",
      updatedAt: now + 10_000,
    });
  });

  test("a grouped row stays informational when its newest follower is gone", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await follow(ctx, s.mara, s.viewer);
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.other, s.mara],
        actorCount: 2,
      });
      await ctx.db.delete(s.other);
    });
    const view = await onlyView(s);
    expect(view.actors[0]).toEqual({ anonymous: true, departed: true });
    expect(view.state).toBe("informational");
    expect(view.href).toBe("/people");
  });

  test("follow_request_approved: resolved following, follow back after the viewer unfollowed", async () => {
    const s = await setup();
    const edge = await s.t.run(async (ctx) => {
      await notify(ctx, s.viewer, {
        type: "follow_request_approved",
        actorIds: [s.priv],
        actorCount: 1,
      });
      return follow(ctx, s.viewer, s.priv);
    });
    expect((await onlyView(s)).resolvedAs).toBe("following");
    await s.t.run((ctx) => ctx.db.delete(edge));
    expect((await onlyView(s)).availableActions).toEqual(["follow_back"]);
  });
});

describe("follow_request_received live state", () => {
  const seed = (
    s: Setup,
    status: "pending" | "approved" | "declined" | null,
    requestId = "req-1",
  ) =>
    s.t.run(async (ctx) => {
      if (status) {
        await ctx.db.insert("followRequests", {
          aggregateId: requestId,
          requesterId: s.priv,
          targetId: s.viewer,
          status,
          createdAt: now,
        });
      }
      await notify(ctx, s.viewer, {
        type: "follow_request_received",
        actorIds: [s.priv],
        actorCount: 1,
        subject: { kind: "followRequest", requestId: "req-1" },
      });
    });

  test("pending offers approve, approve & follow back and decline", async () => {
    const s = await setup();
    await seed(s, "pending");
    const view = await onlyView(s);
    expect(view.state).toBe("actionable");
    expect(view.availableActions).toEqual([
      "approve_follow_request",
      "approve_and_follow_back",
      "decline_follow_request",
    ]);
    expect(view.href).toBe("/members/priv-slug");
  });

  test("pending, viewer already follows the requester: no approve & follow back", async () => {
    const s = await setup();
    await seed(s, "pending");
    await s.t.run((ctx) => follow(ctx, s.viewer, s.priv));
    expect((await onlyView(s)).availableActions).toEqual([
      "approve_follow_request",
      "decline_follow_request",
    ]);
  });

  test.each([
    ["approved", "approved"],
    ["declined", "declined"],
    [null, "expired"],
  ] as const)("%s elsewhere resolves as %s", async (status, resolvedAs) => {
    const s = await setup();
    await seed(s, status);
    const view = await onlyView(s);
    expect(view.state).toBe("resolved");
    expect(view.resolvedAs).toBe(resolvedAs);
  });

  test("a re-sent request (new id) is found through the requester/target pair", async () => {
    const s = await setup();
    await seed(s, "pending", "req-2");
    expect((await onlyView(s)).state).toBe("actionable");
  });
});

describe("household_invite_received live state", () => {
  const seed = (
    s: Setup,
    status: "pending" | "accepted" | "declined" | null,
    invitee?: Id<"users">,
  ) =>
    s.t.run(async (ctx) => {
      if (status) {
        await ctx.db.insert("householdInvites", {
          aggregateId: "inv-1",
          householdId: "hh-1",
          inviterId: s.priv,
          inviteeId: invitee ?? s.viewer,
          status,
          createdAt: now,
        });
      }
      await notify(ctx, s.viewer, {
        type: "household_invite_received",
        actorIds: [s.priv],
        actorCount: 1,
        subject: { kind: "householdInvite", inviteId: "inv-1" },
      });
    });

  test("pending, addressed to the viewer, offers accept and decline", async () => {
    const s = await setup();
    await seed(s, "pending");
    const view = await onlyView(s);
    expect(view.availableActions).toEqual([
      "accept_household_invite",
      "decline_household_invite",
    ]);
    expect(view.href).toBe("/household");
    expect(view.actors[0]).toMatchObject({ anonymous: false });
  });

  test.each([
    ["accepted", "joined"],
    ["declined", "declined"],
    [null, "expired"],
  ] as const)("%s resolves as %s", async (status, resolvedAs) => {
    const s = await setup();
    await seed(s, status);
    expect((await onlyView(s)).resolvedAs).toBe(resolvedAs);
  });

  test("an invite addressed to someone else is not actionable", async () => {
    const s = await setup();
    await seed(s, "pending", s.other);
    const view = await onlyView(s);
    expect(view.availableActions).toEqual([]);
    expect(view.resolvedAs).toBe("expired");
  });
});

describe("message_received", () => {
  const seedThread = (s: Setup, participants: Id<"users">[]) =>
    s.t.run(async (ctx) => {
      await ctx.db.insert("threads", {
        aggregateId: "thread-1",
        subjectKind: "dm",
        participants,
        participantsKey: [...participants].sort().join("|"),
        readReceipts: [],
        createdAt: now,
      });
      await ctx.db.insert("threadMessages", {
        threadAggregateId: "thread-1",
        messageId: "m1",
        authorId: s.mara,
        kind: "text",
        body: "old",
        sentAt: now,
      });
      await ctx.db.insert("threadMessages", {
        threadAggregateId: "thread-1",
        messageId: "m2",
        authorId: s.mara,
        kind: "text",
        body: `Hi! ${"x".repeat(120)}`,
        sentAt: now + 1,
      });
      await notify(ctx, s.viewer, {
        type: "message_received",
        actorIds: [s.mara],
        actorCount: 1,
        subject: { kind: "thread", threadId: "thread-1" },
        relatedId: "thread-1",
      });
    });

  test("a participant gets reply, the thread link and a truncated preview of the latest message", async () => {
    const s = await setup();
    await seedThread(s, [s.viewer, s.mara]);
    const view = await onlyView(s);
    expect(view.availableActions).toEqual(["reply_message"]);
    expect(view.href).toBe("/messages/thread-1");
    expect(view.context.messagePreview?.startsWith("Hi! x")).toBe(true);
    expect(view.context.messagePreview).toHaveLength(80);
  });

  test("a former participant gets no preview, no reply and no thread link", async () => {
    const s = await setup();
    await seedThread(s, [s.other, s.mara]);
    const view = await onlyView(s);
    expect(view.state).toBe("unavailable");
    expect(view.availableActions).toEqual([]);
    expect(view.href).toBe("/messages");
    expect(view.context).not.toHaveProperty("messagePreview");
  });
});

describe("trades", () => {
  const seedExchange = (s: Setup, recipient: Id<"users">) =>
    s.t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Catalog Title",
        pieceCount: 1000,
        status: "approved",
        submittedBy: s.mara,
        createdAt: now,
        updatedAt: now,
      });
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: recipient,
        snapshot: { title: "Starry Night", pieceCount: 1000 },
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("exchanges", {
        aggregateId: "ex-1",
        initiatorId: s.mara,
        recipientId: recipient,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "trade_request",
        actorIds: [s.mara],
        actorCount: 1,
        subject: { kind: "exchange", exchangeId: "ex-1" },
      });
    });

  test("carries the live exchange status, the copy title and a deep link; never actions", async () => {
    const s = await setup();
    await seedExchange(s, s.viewer);
    const view = await onlyView(s);
    expect(view.context).toEqual({
      exchangeStatus: "accepted",
      puzzleTitle: "Starry Night",
    });
    expect(view.href).toBe("/trades?exchange=ex-1");
    expect(view.state).toBe("informational");
    expect(view.availableActions).toEqual([]);
  });

  test("an exchange the viewer is no party to (or gone) is unavailable", async () => {
    const s = await setup();
    await seedExchange(s, s.other);
    const view = await onlyView(s);
    expect(view.state).toBe("unavailable");
    expect(view.context).toEqual({});
    expect(view.href).toBe("/trades");
  });
});

describe("unavailable targets fall back to the params snapshot", () => {
  test("a disabled puzzle", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Live Title",
        pieceCount: 500,
        status: "disabled",
        submittedBy: s.viewer,
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "proposal_rejected",
        subject: { kind: "puzzle", puzzleId },
        params: { puzzleTitle: "Snapshot Title", reason: "Duplicate" },
      });
    });
    const view = await onlyView(s);
    expect(view.state).toBe("unavailable");
    expect(view.context).toEqual({
      puzzleTitle: "Snapshot Title",
      reason: "Duplicate",
    });
    expect(view.href).toBe("/puzzles");
  });

  test("an approved puzzle resolves its live title and link", async () => {
    const s = await setup();
    const puzzleId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("puzzles", {
        title: "Live Title",
        pieceCount: 500,
        status: "approved",
        submittedBy: s.viewer,
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "puzzle_approved",
        subject: { kind: "puzzle", puzzleId: id },
        params: { puzzleTitle: "Snapshot Title" },
      });
      return id;
    });
    const view = await onlyView(s);
    expect(view.state).toBe("informational");
    expect(view.context.puzzleTitle).toBe("Live Title");
    expect(view.href).toBe(`/puzzles/${puzzleId}`);
  });

  test("a deleted goal and a deleted copy", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const goalId = await ctx.db.insert("goals", {
        userId: s.viewer,
        title: "Live goal",
        targetCompletions: 5,
        currentCompletions: 5,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "goal_achieved",
        subject: { kind: "goal", goalId },
        params: { goalTitle: "Snapshot goal" },
      });
      await ctx.db.delete(goalId);
    });
    let view = await onlyView(s);
    expect(view.state).toBe("unavailable");
    expect(view.context).toEqual({ goalTitle: "Snapshot goal" });

    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("notifications").collect()) {
        await ctx.db.delete(row._id);
      }
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "P",
        pieceCount: 500,
        status: "approved",
        submittedBy: s.viewer,
        createdAt: now,
        updatedAt: now,
      });
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: s.viewer,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await notify(ctx, s.viewer, {
        type: "photo_removed",
        subject: { kind: "copy", copyId },
      });
      await ctx.db.delete(copyId);
    });
    view = await onlyView(s);
    expect(view.state).toBe("unavailable");
    expect(view.href).toBe("/my-puzzles");
  });

  test("review rating comes from params", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      notify(ctx, s.viewer, {
        type: "review_received",
        actorIds: [s.mara],
        actorCount: 1,
        subject: { kind: "review", reviewId: "rev-1" },
        params: { rating: "4" },
      }),
    );
    const view = await onlyView(s);
    expect(view.context).toEqual({ rating: 4 });
    expect(view.href).toBe("/profile");
  });
});

describe("admin re-check", () => {
  test("admin rows are dropped for a non-admin viewer and kept for an admin", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await notify(ctx, s.viewer, {
        type: "admin_proposal_filed",
        actorIds: [s.priv],
        actorCount: 1,
        subject: { kind: "changeProposal", proposalId: "cp-1" },
        params: { puzzleTitle: "Starry Night" },
      });
      await notify(ctx, s.viewer, { type: "whats_new" });
    });
    expect((await viewsAs(s)).map((v) => v.type)).toEqual(["whats_new"]);

    const adminPage = await viewsAs(s, "viewer", 30, true);
    expect(adminPage.map((v) => v.type)).toEqual([
      "whats_new",
      "admin_proposal_filed",
    ]);
    const admin = adminPage[1]!;
    expect(admin.href).toBe("/admin/puzzles/proposals/cp-1");
    expect(admin.actors[0]).toMatchObject({ anonymous: false });
    expect(admin.context).toEqual({ puzzleTitle: "Starry Night" });
  });
});

describe("legacy rows without refs", () => {
  test("keep the relatedId-based link, no actors, informational", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await notify(ctx, s.viewer, {
        type: "new_follower",
        relatedId: s.mara,
        params: { actorName: "Mara" },
      });
      await notify(ctx, s.viewer, {
        type: "message_received",
        relatedId: "thread-legacy",
      });
      // Pre-domain row: no aggregateId and no channel.
      await ctx.db.insert("notifications", {
        userId: s.viewer,
        type: "puzzle_approved",
        relatedId: "puzzle-legacy",
        isRead: true,
        createdAt: now + 1000,
      });
    });
    const page = await viewsAs(s);
    expect(page.map((v) => [v.type, v.href, v.state, v.actors.length])).toEqual(
      [
        ["puzzle_approved", "/puzzles/puzzle-legacy", "informational", 0],
        ["message_received", "/messages/thread-legacy", "informational", 0],
        ["new_follower", "/people", "informational", 0],
      ],
    );
    expect(page[0]!.isRead).toBe(true);
    expect(page[0]!.id).toMatch(/.+/);
    expect(page[2]!.actorCount).toBe(0);
  });

  test("expose the stored actor name only for initiator types without actor refs", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      // Legacy initiator row: the snapshot is all that is left of the actor.
      await notify(ctx, s.viewer, {
        type: "new_follower",
        params: { actorName: "Mara" },
      });
      // Not an initiator type (a moderator's outcome): the name never surfaces.
      await notify(ctx, s.viewer, {
        type: "puzzle_rejected",
        params: { actorName: "Moderator", puzzleTitle: "Sky" },
      });
      // Refs present: the resolved actor wins, no snapshot.
      await notify(ctx, s.viewer, {
        type: "new_follower",
        actorIds: [s.mara],
        actorCount: 1,
        params: { actorName: "Old Mara" },
      });
    });
    const page = await viewsAs(s);
    expect(page.map((v) => v.context.actorNameSnapshot)).toEqual([
      undefined,
      undefined,
      "Mara",
    ]);
  });
});

describe("pagination", () => {
  test("newest first, limited, with a working cursor", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 5; i += 1) {
        await notify(ctx, s.viewer, {
          type: "whats_new",
          subject: { kind: "whatsNew", entryId: `e${i}` },
        });
      }
    });
    const as = s.t.withIdentity({ subject: "viewer" });
    const fn =
      api.notifications.listMyNotificationViews.listMyNotificationViews;
    const first = await as.query(fn, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(first.page.map((v) => v.href)).toEqual([
      "/whats-new#entry-e4",
      "/whats-new#entry-e3",
      "/whats-new#entry-e2",
    ]);
    expect(first.isDone).toBe(false);
    const second = await as.query(fn, {
      paginationOpts: { numItems: 3, cursor: first.continueCursor },
    });
    expect(second.page.map((v) => v.href)).toEqual([
      "/whats-new#entry-e1",
      "/whats-new#entry-e0",
    ]);
    expect(second.isDone).toBe(true);
  });

  test("caps a page at 100 rows", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 105; i += 1) {
        await notify(ctx, s.viewer, { type: "whats_new" });
      }
    });
    const page = await viewsAs(s, "viewer", 500);
    expect(page).toHaveLength(100);
  });
});
