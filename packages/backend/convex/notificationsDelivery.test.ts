import {
  Notification,
  toMemberId,
  toNotificationId,
  type NotificationState,
} from "@jigswap/domain";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { emailChannel } from "./notifications/adapters/channels/emailChannel";
import { pushChannel } from "./notifications/adapters/channels/pushChannel";
import { pushTextOf } from "./notifications/copy";
import schema from "./schema";

// web-push signs and POSTs to the push service over https; replace it so the send action's payload
// can be inspected. Only sendWebPush imports it.
const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(async () => ({ statusCode: 201 })),
}));
vi.mock("web-push", () => ({ default: webPushMock }));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Rich email + push: at send time the out-of-band channels resolve the delivery for the recipient
// through the in-app read model (notifications/resolveForDelivery), so they show the same actor,
// context and deep link as the bell, and drop admin types for a recipient who lost the role.

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

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = {
      viewer: await mkUser(ctx, "viewer", { preferredLanguage: "nl" }),
      mara: await mkUser(ctx, "mara", { username: "mara_u" }),
      priv: await mkUser(ctx, "priv", { slug: "priv-slug" }),
      gone: await mkUser(ctx, "gone", { isActive: false }),
      nameless: await mkUser(ctx, "nameless", { name: undefined }),
      admin: await mkUser(ctx, "admin", { role: "admin" }),
    };
    await ctx.db.insert("profiles", {
      memberId: ids.mara,
      visibility: "public",
      displayName: "Mara Display",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: ids.priv,
      visibility: "private",
      updatedAt: now,
    });
    return ids;
  });
  return { t, ...ids };
};

type Setup = Awaited<ReturnType<typeof setup>>;

type ResolveArgs = {
  recipientId: Id<"users">;
  type: Doc<"notifications">["type"];
  params?: Record<string, string>;
  relatedId?: string;
  actorId?: Id<"users">;
  subject?: Doc<"notifications">["subject"];
};

const resolve = (s: Setup, args: ResolveArgs) =>
  s.t.query(internal.notifications.resolveForDelivery.resolveForDelivery, args);

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
      body: "Still have the Ravensburger?",
      sentAt: now,
    });
  });

const seedExchange = (s: Setup) =>
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
      ownerId: s.viewer,
      snapshot: { title: "Starry Night", pieceCount: 1000 },
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("exchanges", {
      aggregateId: "ex-1",
      initiatorId: s.mara,
      recipientId: s.viewer,
      type: "trade",
      requestedPuzzleId: copyId,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
  });

const seedPuzzle = (s: Setup, status: "approved" | "disabled") =>
  s.t.run((ctx) =>
    ctx.db.insert("puzzles", {
      title: "Live Title",
      pieceCount: 500,
      status,
      submittedBy: s.mara,
      createdAt: now,
      updatedAt: now,
    }),
  );

describe("resolveForDelivery: actor", () => {
  test("names the actor by the profile display name and deep-links their profile", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "new_follower",
      params: { actorName: "Stale Snapshot" },
      relatedId: s.mara,
      actorId: s.mara,
    });
    expect(content).toEqual({
      params: { actorName: "Mara Display" },
      actorAnonymous: false,
      href: "/members/mara_u",
    });
  });

  test("names a private initiator (they contacted the recipient) and links their slug", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "follow_request_received",
      params: {},
      actorId: s.priv,
      subject: { kind: "followRequest", requestId: "req-1" },
    });
    expect(content?.params.actorName).toBe("priv name");
    expect(content?.href).toBe("/members/priv-slug");
  });

  test("a deactivated actor is anonymous: the snapshot name is dropped and there is no link", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "new_follower",
      params: { actorName: "gone name" },
      actorId: s.gone,
    });
    expect(content).toEqual({ params: {}, actorAnonymous: true, href: null });
  });

  test("a deleted actor is anonymous", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete(s.mara));
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "message_received",
      params: { actorName: "Mara Display" },
      actorId: s.mara,
    });
    expect(content?.actorAnonymous).toBe(true);
    expect(content?.params).not.toHaveProperty("actorName");
  });

  test("a nameless actor carries no name (renderers use their generic fallback), not anonymous", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "new_follower",
      params: {},
      actorId: s.nameless,
    });
    expect(content?.actorAnonymous).toBe(false);
    expect(content?.params).toEqual({});
    expect(content?.href).toBe(`/members/${s.nameless}`);
  });

  test("never carries another member's email", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "new_follower",
      params: {},
      actorId: s.nameless,
    });
    expect(JSON.stringify(content)).not.toContain("@example.com");
  });
});

describe("resolveForDelivery: context and deep links", () => {
  test("message_received links the thread and carries the latest message preview", async () => {
    const s = await setup();
    await seedThread(s, [s.viewer, s.mara]);
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "message_received",
      params: { actorName: "Mara Display" },
      relatedId: "thread-1",
      actorId: s.mara,
      subject: { kind: "thread", threadId: "thread-1" },
    });
    expect(content).toEqual({
      params: {
        actorName: "Mara Display",
        messagePreview: "Still have the Ravensburger?",
      },
      actorAnonymous: false,
      href: "/messages/thread-1",
    });
  });

  test("message_received for a photo carries its kind, never the caption or attachment", async () => {
    const s = await setup();
    await seedThread(s, [s.viewer, s.mara]);
    await s.t.run(async (ctx) =>
      ctx.db.insert("threadMessages", {
        threadAggregateId: "thread-1",
        messageId: "m2",
        authorId: s.mara,
        kind: "image",
        body: "secret caption",
        sentAt: now + 1,
        attachmentId: await ctx.db.insert("messageAttachments", {
          kind: "image",
          threadAggregateId: "thread-1",
          uploaderId: s.mara,
          fileId: await ctx.storage.store(new Blob(["x"])),
          byteSize: 1,
          contentType: "image/jpeg",
          moderationStatus: "approved",
          createdAt: now,
          updatedAt: now,
        }),
      }),
    );
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "message_received",
      params: { actorName: "Mara Display" },
      relatedId: "thread-1",
      actorId: s.mara,
      subject: { kind: "thread", threadId: "thread-1" },
    });
    expect(content?.params).toEqual({
      actorName: "Mara Display",
      messageKind: "image",
    });
    expect(pushTextOf("message_received", content!)).toEqual({
      title: "New message from Mara Display",
      message: "Mara Display sent a photo",
    });
  });

  test("a recipient no longer in the thread gets no preview and the inbox link", async () => {
    const s = await setup();
    await seedThread(s, [s.priv, s.mara]);
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "message_received",
      params: {},
      actorId: s.mara,
      subject: { kind: "thread", threadId: "thread-1" },
    });
    expect(content?.params).not.toHaveProperty("messagePreview");
    expect(content?.href).toBe("/messages");
  });

  test("trade types deep-link the exchange with the copy title and live status", async () => {
    const s = await setup();
    await seedExchange(s);
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "trade_request",
      params: { actorName: "Mara Display" },
      actorId: s.mara,
      subject: { kind: "exchange", exchangeId: "ex-1" },
    });
    expect(content).toEqual({
      params: {
        actorName: "Mara Display",
        puzzleTitle: "Starry Night",
        exchangeStatus: "proposed",
      },
      actorAnonymous: false,
      href: "/trades?exchange=ex-1",
    });
  });

  test("the live puzzle title wins over the snapshot and links the puzzle", async () => {
    const s = await setup();
    const puzzleId = await seedPuzzle(s, "approved");
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "proposal_rejected",
      params: { puzzleTitle: "Old Title", reason: "duplicate" },
      relatedId: puzzleId,
      subject: { kind: "puzzle", puzzleId },
    });
    expect(content?.params).toEqual({
      puzzleTitle: "Live Title",
      reason: "duplicate",
    });
    expect(content?.href).toBe(`/puzzles/${puzzleId}`);
  });

  test("an unavailable puzzle falls back to the snapshot title and the catalog", async () => {
    const s = await setup();
    const puzzleId = await seedPuzzle(s, "disabled");
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "proposal_approved",
      params: { puzzleTitle: "Old Title" },
      relatedId: puzzleId,
      subject: { kind: "puzzle", puzzleId },
    });
    expect(content?.params).toEqual({ puzzleTitle: "Old Title" });
    expect(content?.href).toBe("/puzzles");
  });

  test("a review carries the snapshotted rating", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "review_received",
      params: { rating: "4" },
      actorId: s.priv,
      subject: { kind: "review", reviewId: "rev-1" },
    });
    expect(content?.params).toEqual({ actorName: "priv name", rating: "4" });
    expect(content?.href).toBe("/profile");
  });

  test("a delivery without refs keeps its snapshot and the legacy link", async () => {
    const s = await setup();
    const content = await resolve(s, {
      recipientId: s.viewer,
      type: "message_received",
      params: { actorName: "Snapshot" },
      relatedId: "thread-x",
    });
    expect(content).toEqual({
      params: { actorName: "Snapshot" },
      actorAnonymous: false,
      href: "/messages/thread-x",
    });
  });
});

describe("resolveForDelivery: admin re-check", () => {
  const adminDelivery = (recipientId: Id<"users">, actorId: Id<"users">) => ({
    recipientId,
    type: "admin_proposal_filed" as const,
    params: { puzzleTitle: "Sky" },
    relatedId: "cp-1",
    actorId,
    subject: { kind: "changeProposal" as const, proposalId: "cp-1" },
  });

  test("an admin recipient gets it, naming the proposer and linking the review", async () => {
    const s = await setup();
    const content = await resolve(s, adminDelivery(s.admin, s.priv));
    expect(content).toEqual({
      params: { actorName: "priv name", puzzleTitle: "Sky" },
      actorAnonymous: false,
      href: "/admin/puzzles/proposals/cp-1",
    });
  });

  test("a recipient who lost the admin role gets nothing", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.admin, { role: "member" }));
    expect(await resolve(s, adminDelivery(s.admin, s.priv))).toBeNull();
  });
});

// --- channels forward the refs to the send actions ---

const notification = (
  s: Setup,
  extra: Partial<NotificationState>,
): Notification =>
  Notification.rehydrate({
    id: toNotificationId("notif-1"),
    userId: toMemberId(s.viewer as unknown as string),
    type: "trade_request",
    params: { actorName: "Mara Display" },
    relatedId: "row-1",
    actorId: toMemberId(s.mara as unknown as string),
    subject: { kind: "exchange", exchangeId: "ex-1" },
    channel: "email",
    isRead: false,
    createdAt: new Date(now),
    ...extra,
  });

const scheduledArgs = async (s: Setup, name: string) => {
  const jobs = await s.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return jobs
    .filter((job) => job.name.includes(name))
    .map((job) => job.args[0]);
};

describe("channels", () => {
  // The channels schedule the real sendEmail/sendWebPush actions (runAfter 0), and convex-test
  // runs those on real timers. These tests only assert on the scheduled rows, so keep the jobs
  // from ever running: under CI load they otherwise fired during the later "sendEmail action"
  // tests and hit that block's stubbed fetch (3 calls instead of 1). useRealTimers drops them.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the email channel forwards the recipient and the refs", async () => {
    const s = await setup();
    await s.t.run((ctx) => emailChannel(ctx)(notification(s, {})));
    expect(await scheduledArgs(s, "sendEmail")).toEqual([
      expect.objectContaining({
        to: "viewer@example.com",
        locale: "nl",
        userId: s.viewer,
        actorId: s.mara,
        subject: { kind: "exchange", exchangeId: "ex-1" },
        params: { actorName: "Mara Display" },
      }),
    ]);
  });

  test("the push channel forwards params and refs next to the snapshot text", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      pushChannel(ctx)(notification(s, { channel: "push" })),
    );
    expect(await scheduledArgs(s, "sendWebPush")).toEqual([
      expect.objectContaining({
        userId: s.viewer,
        title: "New Exchange Request",
        message: "Mara Display wants to trade for one of your puzzles",
        params: { actorName: "Mara Display" },
        actorId: s.mara,
        subject: { kind: "exchange", exchangeId: "ex-1" },
      }),
    ]);
  });

  test("a delivery without refs forwards none", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      emailChannel(ctx)(
        notification(s, { actorId: undefined, subject: undefined }),
      ),
    );
    const [args] = await scheduledArgs(s, "sendEmail");
    expect(args).not.toHaveProperty("actorId");
    expect(args).not.toHaveProperty("subject");
  });
});

// --- the send actions render the resolved content ---

describe("sendEmail action", () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: [] }), { status: 202 }),
  );
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AHASEND_API_KEY", "aha-sk-test");
    vi.stubEnv("AHASEND_ACCOUNT_ID", "acc-1");
    vi.stubEnv("EMAIL_BASE_URL", "https://jigswap.site");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const sentBody = () => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    return JSON.parse(init.body as string) as {
      from: { name: string };
      subject: string;
      html_content: string;
      text_content: string;
    };
  };

  test("renders the resolved actor, the live context and the deep link (nl)", async () => {
    const s = await setup();
    await seedExchange(s);
    await s.t.action(internal.notifications.sendEmail.send, {
      to: "viewer@example.com",
      toName: "viewer",
      type: "trade_request",
      params: { actorName: "Stale" },
      locale: "nl",
      idempotencyKey: "notif-1",
      userId: s.viewer,
      actorId: s.mara,
      subject: { kind: "exchange", exchangeId: "ex-1" },
    });
    const body = sentBody();
    expect(body.from.name).toBe("Mara Display | JigSwap");
    expect(body.text_content).toContain(
      "Mara Display wil ruilen voor “Starry Night”.",
    );
    expect(body.html_content).toContain(
      "https://jigswap.site/trades?exchange=ex-1",
    );
    expect(body.text_content).toContain("Bekijk ruilverzoek");
    expect(body.html_content).not.toContain("Stale");
  });

  test("labels a deactivated actor as a former member", async () => {
    const s = await setup();
    await s.t.action(internal.notifications.sendEmail.send, {
      to: "viewer@example.com",
      toName: "viewer",
      type: "new_follower",
      params: { actorName: "gone name" },
      locale: "en",
      idempotencyKey: "notif-2",
      userId: s.viewer,
      actorId: s.gone,
    });
    const body = sentBody();
    expect(body.subject).toBe("Former member started following you on JigSwap");
    expect(body.from.name).toBe("JigSwap");
    expect(body.html_content).not.toContain("gone name");
    expect(body.html_content).toContain("https://jigswap.site/people");
  });

  test("a payload scheduled before rich delivery renders its snapshot", async () => {
    const s = await setup();
    await s.t.action(internal.notifications.sendEmail.send, {
      to: "viewer@example.com",
      toName: "viewer",
      type: "message_received",
      params: { actorName: "Anna" },
      locale: "en",
      relatedId: "thread-9",
      idempotencyKey: "notif-3",
    });
    const body = sentBody();
    expect(body.subject).toBe("New message from Anna on JigSwap");
    expect(body.html_content).toContain(
      "https://jigswap.site/messages/thread-9",
    );
  });
});

describe("sendWebPush action", () => {
  beforeEach(() => {
    webPushMock.sendNotification.mockClear();
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  });
  afterEach(() => vi.unstubAllEnvs());

  const subscribe = (s: Setup, userId: Id<"users">) =>
    s.t.run((ctx) =>
      ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint: `https://push.example/${userId}`,
        p256dh: "p",
        auth: "a",
        createdAt: now,
      }),
    );

  const sentPayload = () => {
    expect(webPushMock.sendNotification).toHaveBeenCalledTimes(1);
    const call = webPushMock.sendNotification.mock.calls[0] as unknown as [
      unknown,
      string,
    ];
    return JSON.parse(call[1]) as { title: string; body: string; url: string };
  };

  test("names the actor, quotes the message and links the thread", async () => {
    const s = await setup();
    await subscribe(s, s.viewer);
    await seedThread(s, [s.viewer, s.mara]);
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.viewer,
      type: "message_received",
      title: "New message",
      message: "Stale sent you a message",
      relatedId: "thread-1",
      params: { actorName: "Stale" },
      actorId: s.mara,
      subject: { kind: "thread", threadId: "thread-1" },
    });
    expect(sentPayload()).toMatchObject({
      title: "New message from Mara Display",
      body: "Still have the Ravensburger?",
      url: "/messages/thread-1",
      // One OS notification per thread: a later push replaces this one.
      tag: "thread:thread-1",
    });
  });

  test("links the specific exchange", async () => {
    const s = await setup();
    await subscribe(s, s.viewer);
    await seedExchange(s);
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.viewer,
      type: "trade_request",
      title: "New Exchange Request",
      message: "x",
      params: {},
      actorId: s.mara,
      subject: { kind: "exchange", exchangeId: "ex-1" },
    });
    expect(sentPayload()).toMatchObject({
      body: 'Mara Display wants to trade for "Starry Night"',
      url: "/trades?exchange=ex-1",
      tag: "trade_request",
    });
  });

  test("labels a deactivated actor as a former member and falls back to the legacy URL", async () => {
    const s = await setup();
    await subscribe(s, s.viewer);
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.viewer,
      type: "new_follower",
      title: "New follower",
      message: "gone name started following you",
      params: { actorName: "gone name" },
      actorId: s.gone,
    });
    expect(sentPayload()).toMatchObject({
      body: "Former member started following you",
      url: "/people",
    });
  });

  test("drops an admin type for a recipient who lost the role", async () => {
    const s = await setup();
    await subscribe(s, s.admin);
    await s.t.run((ctx) => ctx.db.patch(s.admin, { role: "member" }));
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.admin,
      type: "admin_definition_submitted",
      title: "Submission to Moderate",
      message: "x",
      params: { puzzleTitle: "Sky" },
      actorId: s.priv,
    });
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  test("still sends an admin type to a current admin", async () => {
    const s = await setup();
    await subscribe(s, s.admin);
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.admin,
      type: "admin_definition_submitted",
      title: "Submission to Moderate",
      message: "x",
      params: { puzzleTitle: "Sky" },
      actorId: s.priv,
    });
    expect(sentPayload()).toMatchObject({
      body: '"Sky" awaits moderation',
      url: "/admin/moderation",
    });
  });

  test("a payload scheduled before rich delivery sends its snapshot with the legacy URL", async () => {
    const s = await setup();
    await subscribe(s, s.viewer);
    await s.t.action(internal.notifications.sendWebPush.send, {
      userId: s.viewer,
      type: "message_received",
      title: "New message",
      message: "Anna sent you a message",
      relatedId: "thread-1",
    });
    expect(sentPayload()).toEqual({
      title: "New message",
      body: "Anna sent you a message",
      type: "message_received",
      relatedId: "thread-1",
      url: "/messages",
      tag: "message_received",
    });
  });
});
