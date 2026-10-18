import {
  Notification,
  toMemberId,
  toNotificationId,
  type NotificationType,
} from "@jigswap/domain";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  GROUP_WINDOW_MS,
  inAppChannel,
} from "./notifications/adapters/channels/inAppChannel";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Write-time grouping of new_follower in the in-app channel: a follower joins the recipient's
// unread new_follower row touched within 24 h (deduped, ids capped at 10, actorCount keeps
// counting), and the merged row moves to the top of the feed. Rows are delivered through the
// channel directly with an explicit creation time, so the window is deterministic.

const t0 = Date.UTC(2026, 9, 1, 12);
const HOUR = 60 * 60 * 1000;

const mkUser = (ctx: MutationCtx, clerkId: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: `${clerkId} name`,
    isActive: true,
    createdAt: t0,
    updatedAt: t0,
  });

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const viewer = await mkUser(ctx, "viewer");
    const followers: Id<"users">[] = [];
    for (let i = 0; i < 12; i += 1) followers.push(await mkUser(ctx, `f${i}`));
    return { viewer, followers };
  });
  return { t, ...ids };
};
type Setup = Awaited<ReturnType<typeof setup>>;

let seq = 0;
const deliver = (
  s: Setup,
  actor: Id<"users">,
  at: number,
  type: NotificationType = "new_follower",
) => {
  seq += 1;
  const notification = Notification.rehydrate({
    id: toNotificationId(`notif-${seq}`),
    userId: toMemberId(s.viewer as unknown as string),
    type,
    params: { actorName: `${actor} name` },
    relatedId: actor as unknown as string,
    actorId: toMemberId(actor as unknown as string),
    channel: "inApp",
    isRead: false,
    createdAt: new Date(at),
  });
  return s.t.run((ctx) => inAppChannel(ctx)(notification));
};

const rows = (s: Setup): Promise<Doc<"notifications">[]> =>
  s.t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", s.viewer))
      .order("desc")
      .collect(),
  );

const asViewer = (s: Setup) => s.t.withIdentity({ subject: "viewer" });

const views = async (s: Setup) =>
  (
    await asViewer(s).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 30, cursor: null } },
    )
  ).page;

describe("new_follower grouping", () => {
  test("a follower within the window merges into the unread row, newest first", async () => {
    const s = await setup();
    const [a, b, c] = s.followers as [Id<"users">, Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    await deliver(s, b, t0 + HOUR);
    await deliver(s, c, t0 + 23 * HOUR);

    const [row, ...rest] = await rows(s);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      aggregateId: "notif-" + (seq - 2),
      groupKey: "new_follower",
      actorIds: [c, b, a],
      actorCount: 3,
      isRead: false,
      createdAt: t0,
      updatedAt: t0 + 23 * HOUR,
      params: { actorName: `${c} name` },
      relatedId: c,
    });
  });

  test("a repeated follower moves to the front without counting twice", async () => {
    const s = await setup();
    const [a, b] = s.followers as [Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    await deliver(s, b, t0 + HOUR);
    await deliver(s, a, t0 + 2 * HOUR);

    const all = await rows(s);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ actorIds: [a, b], actorCount: 2 });
  });

  test("a read row is not merged into: the next follower opens a new row", async () => {
    const s = await setup();
    const [a, b] = s.followers as [Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    const [first] = await rows(s);
    await asViewer(s).mutation(
      api.notifications.markNotificationRead.markNotificationRead,
      { notificationId: first!.aggregateId! },
    );
    await deliver(s, b, t0 + HOUR);

    const all = await rows(s);
    expect(all.map((r) => [r.actorIds, r.isRead])).toEqual([
      [[b], false],
      [[a], true],
    ]);
    expect(all[0]?.groupKey).toBe("new_follower");
  });

  test("past 24 h since the row last absorbed a follower, a new row opens", async () => {
    const s = await setup();
    const [a, b, c] = s.followers as [Id<"users">, Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    // The window runs from the last merge (updatedAt), not the row's creation.
    await deliver(s, b, t0 + 20 * HOUR);
    await deliver(s, c, t0 + 20 * HOUR + GROUP_WINDOW_MS + 1);

    const all = await rows(s);
    expect(all.map((r) => [r.actorIds, r.actorCount])).toEqual([
      [[c], 1],
      [[b, a], 2],
    ]);
  });

  test("stored ids are capped at 10 while actorCount keeps counting", async () => {
    const s = await setup();
    for (const [i, follower] of s.followers.entries()) {
      await deliver(s, follower, t0 + i * HOUR);
    }

    const all = await rows(s);
    expect(all).toHaveLength(1);
    expect(all[0]?.actorIds).toEqual([...s.followers].reverse().slice(0, 10));
    expect(all[0]?.actorCount).toBe(12);
  });

  test("other types are never grouped", async () => {
    const s = await setup();
    const [a, b] = s.followers as [Id<"users">, Id<"users">];
    await deliver(s, a, t0, "follow_request_approved");
    await deliver(s, b, t0 + HOUR, "follow_request_approved");

    const all = await rows(s);
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.groupKey === undefined)).toBe(true);
  });
});

describe("grouped rows in the feed", () => {
  test("the merged row surfaces first, keyed on its stable aggregateId", async () => {
    const s = await setup();
    const [a, b, c] = s.followers as [Id<"users">, Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    await deliver(s, b, t0 + HOUR, "follow_request_approved");
    await deliver(s, c, t0 + 2 * HOUR);

    const page = await views(s);
    expect(page.map((v) => [v.id, v.type])).toEqual([
      ["notif-" + (seq - 2), "new_follower"],
      ["notif-" + (seq - 1), "follow_request_approved"],
    ]);
    expect(page[0]).toMatchObject({
      actorCount: 2,
      href: "/people",
      availableActions: [],
      createdAt: t0 + 2 * HOUR,
    });
    expect(page[0]?.actors).toHaveLength(2);
  });

  test("markAllRead keeps every grouped actor", async () => {
    const s = await setup();
    const [a, b] = s.followers as [Id<"users">, Id<"users">];
    await deliver(s, a, t0);
    await deliver(s, b, t0 + HOUR);

    await asViewer(s).mutation(api.notifications.markAllRead.markAllRead, {});

    const [after] = await rows(s);
    expect(after).toMatchObject({
      isRead: true,
      actorIds: [b, a],
      actorCount: 2,
    });
  });
});

describe("out-of-band channels", () => {
  test("email and push stay one delivery per follower", async () => {
    const s = await setup();
    const [a, b] = s.followers as [Id<"users">, Id<"users">];
    await s.t.run(async (ctx) => {
      await ctx.db.insert("notificationPreferences", {
        aggregateId: "pref_viewer",
        memberId: s.viewer,
        toggles: { new_follower: { inApp: true, email: true, push: true } },
        updatedAt: t0,
      });
      // Push is only scheduled for a member with a push subscription.
      await ctx.db.insert("pushSubscriptions", {
        userId: s.viewer,
        endpoint: "https://push.example/viewer",
        p256dh: "p",
        auth: "a",
        createdAt: t0,
      });
      for (const follower of [a, b]) {
        const eventId = await ctx.db.insert("domainEvents", {
          name: "MemberFollowed",
          payload: { followerId: follower, followeeId: s.viewer },
          occurredAt: Date.now(),
          context: "test",
        });
        await handleDomainEvent(
          ctx,
          (await ctx.db.get(eventId)) as Doc<"domainEvents">,
        );
      }
    });

    const jobs = await s.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const count = (name: string) =>
      jobs.filter((job) => job.name.includes(name)).length;
    expect(count("sendEmail")).toBe(2);
    expect(count("sendWebPush")).toBe(2);
    const all = await rows(s);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ actorIds: [b, a], actorCount: 2 });
  });
});
