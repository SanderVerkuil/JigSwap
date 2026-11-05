import presenceTest from "@convex-dev/presence/test";
import type {
  InboxThreadView,
  MessageAttachmentView,
  ThreadMessageView,
} from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PURGE_BATCH_SIZE } from "./conversation/purgeMemberMessagingData";
import schema from "./schema";

// Account deletion for messaging data (spec R.9, 2.8): users.deleteUser schedules
// conversation/purgeMemberMessagingData. Text messages stay with the author shown as a deleted
// member; the member's photos lose their blobs but keep a blurhash placeholder; held and
// quarantined rows are left alone; undelivered rows go; locations lose their coordinates; blocks
// both ways, reveals, GPS picker views and rate-limit counters are deleted; filed reports are
// anonymised while reports about the member are kept. The purge runs in batches.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

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

// Alice, Bob (mutual followers, sharing a DM) and Carol; Ada is an admin.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        preferredLanguage: "en",
        createdAt: 1,
        updatedAt: 1,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    await mkUser("clerk_ada");
    for (const [followerId, followeeId] of [
      [alice, bob],
      [bob, alice],
    ]) {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    }
    return { alice, bob, carol };
  });
  const threadId = await asAlice(t).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: ids.bob },
  );
  return { ...ids, threadId };
};

const blob = (t: T, text = "x") =>
  t.run((ctx) => ctx.storage.store(new Blob([text])));

const blobExists = (t: T, fileId: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(fileId)) !== null);

let sentAt = 1_000;
// A delivered photo: the attachment row plus its image message.
const deliveredPhoto = async (
  t: T,
  threadId: string,
  uploaderId: Id<"users">,
  extra: Partial<Doc<"messageAttachments">> = {},
) => {
  const fileId = await blob(t);
  const thumbFileId = await blob(t, "thumb");
  const messageId = `msg-photo-${sentAt}`;
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: threadId,
      uploaderId,
      fileId,
      thumbFileId,
      width: 1600,
      height: 1200,
      byteSize: 1,
      contentType: "image/jpeg",
      moderationStatus: "approved",
      blurhash: BLURHASH,
      reencodedAt: 1,
      hashCheckedAt: 1,
      messageId,
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    } as Doc<"messageAttachments">);
    await ctx.db.insert("threadMessages", {
      threadAggregateId: threadId,
      messageId,
      authorId: uploaderId,
      kind: "image",
      body: "",
      sentAt: sentAt++,
      attachmentId: id,
    });
    return id;
  });
  return { id, fileId, thumbFileId, messageId };
};

// A photo that is not a message (staged, being checked, or quarantined).
const undeliveredPhoto = async (
  t: T,
  threadId: string,
  uploaderId: Id<"users">,
  moderationStatus: "pending" | "quarantined" = "pending",
) => {
  const fileId = await blob(t);
  const id = await t.run((ctx) =>
    ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: threadId,
      uploaderId,
      fileId,
      byteSize: 1,
      contentType: "image/jpeg",
      moderationStatus,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return { id, fileId };
};

const deliveredLocation = async (
  t: T,
  threadId: string,
  uploaderId: Id<"users">,
) => {
  const mapFileId = await blob(t, "map");
  const messageId = `msg-location-${sentAt}`;
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messageAttachments", {
      kind: "location",
      threadAggregateId: threadId,
      uploaderId,
      lat: 52.37022,
      lng: 4.89517,
      precision: "exact",
      label: "Dam Square",
      mapFileId,
      mapStatus: "ready",
      messageId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("threadMessages", {
      threadAggregateId: threadId,
      messageId,
      authorId: uploaderId,
      kind: "location",
      body: "",
      sentAt: sentAt++,
      attachmentId: id,
    });
    return id;
  });
  return { id, mapFileId };
};

const deleteAlice = async (t: T) => {
  await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
  await settleDueJobs(t);
};

const row = (t: T, id: Id<"messageAttachments">) =>
  t.run((ctx) => ctx.db.get(id));

const bobThread = async (t: T, threadId: string) =>
  (
    await asBob(t).query(
      api.conversation.listThreadMessages.listThreadMessages,
      {
        threadId,
        paginationOpts: { numItems: 50, cursor: null },
      },
    )
  ).page as ThreadMessageView[];

describe("account deletion: messages and read models", () => {
  test("text stays, authored by a member the inbox shows as deleted; notifications still resolve", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    await asAlice(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "See you Saturday",
    });
    await deleteAlice(t);

    expect(await t.run((ctx) => ctx.db.get(alice))).toBeNull();
    const [message] = await bobThread(t, threadId);
    expect(message).toMatchObject({
      kind: "text",
      body: "See you Saturday",
      isMine: false,
    });
    const inbox = (await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    )) as InboxThreadView[];
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject).toMatchObject({
      kind: "dm",
      otherMember: { anonymous: true, departed: true },
      profileHandle: null,
    });
    expect(inbox[0].lastMessage?.body).toBe("See you Saturday");
    await expect(
      asBob(t).query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 20, cursor: null } },
      ),
    ).resolves.toBeDefined();
  });

  test("a tombstoned member (open CSAM escalation) is a deleted member too", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "messageAttachments",
        rowId: "x",
        uploaderId: alice,
        md5: "m",
        sha1: "s",
        provider: "offlimits",
        matchedAt: 1,
        status: "open",
      }),
    );
    await deleteAlice(t);
    expect((await t.run((ctx) => ctx.db.get(alice)))?.isActive).toBe(false);
    const inbox = (await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    )) as InboxThreadView[];
    expect(inbox[0].subject).toMatchObject({
      otherMember: { anonymous: true, departed: true },
    });
    expect(await bobThread(t, threadId)).toEqual([]);
  });
});

describe("account deletion: attachments", () => {
  test("a delivered photo loses its blobs and reveals but keeps a blurhash placeholder", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await seed(t);
    const photo = await deliveredPhoto(t, threadId, alice);
    await t.run((ctx) =>
      ctx.db.insert("messageImageReveals", {
        attachmentId: photo.id,
        viewerId: bob,
        revealedAt: 1,
      }),
    );
    await deleteAlice(t);

    expect(await row(t, photo.id)).toMatchObject({
      moderationStatus: "removed",
      removedReason: "account_deleted",
      blurhash: BLURHASH,
      width: 1600,
      height: 1200,
    });
    expect(await blobExists(t, photo.fileId)).toBe(false);
    expect(await blobExists(t, photo.thumbFileId)).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("messageImageReveals").collect()),
    ).toEqual([]);
    const [message] = await bobThread(t, threadId);
    expect(message.attachment as MessageAttachmentView).toEqual({
      status: "removed",
      unavailable: true,
      blurhash: BLURHASH,
      w: 1600,
      h: 1200,
    });
  });

  test("a photo message that was never servable keeps no blurhash", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    const pending = await deliveredPhoto(t, threadId, alice, {
      moderationStatus: "unscored",
    });
    const rejected = await deliveredPhoto(t, threadId, alice, {
      moderationStatus: "rejected",
    });
    await deleteAlice(t);
    for (const photo of [pending, rejected]) {
      const after = await row(t, photo.id);
      expect(after).toMatchObject({
        moderationStatus: "removed",
        removedReason: "account_deleted",
      });
      expect(after).not.toHaveProperty("blurhash");
    }
    for (const message of await bobThread(t, threadId)) {
      expect(message.attachment).not.toHaveProperty("blurhash");
    }
  });

  test("a rejected photo message stays removed by moderation with its caption withheld; a servable one keeps its caption", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    await deliveredPhoto(t, threadId, alice, { moderationStatus: "rejected" });
    await deliveredPhoto(t, threadId, alice);
    await t.run(async (ctx) => {
      for (const message of await ctx.db.query("threadMessages").collect()) {
        if (message.kind === "image") {
          await ctx.db.patch(message._id, { body: "a caption" });
        }
      }
    });
    await deleteAlice(t);
    // Newest first.
    const [servable, stopped] = await bobThread(t, threadId);
    expect(stopped).toMatchObject({
      body: "",
      attachment: { status: "removed" },
    });
    expect(stopped.attachment).not.toHaveProperty("unavailable");
    expect(servable).toMatchObject({
      body: "a caption",
      attachment: { status: "removed", unavailable: true },
    });
  });

  test("held and quarantined photos are untouched; staged photos are deleted", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    const held = await deliveredPhoto(t, threadId, alice, {
      evidenceHold: true,
    });
    const quarantined = await undeliveredPhoto(
      t,
      threadId,
      alice,
      "quarantined",
    );
    const staged = await undeliveredPhoto(t, threadId, alice);
    await deleteAlice(t);

    // Held: marked for the account, blobs kept for the open report.
    expect(await row(t, held.id)).toMatchObject({
      moderationStatus: "removed",
      removedReason: "account_deleted",
      evidenceHold: true,
    });
    expect(await blobExists(t, held.fileId)).toBe(true);
    // Quarantined: the CSAM preservation owns it.
    expect(await row(t, quarantined.id)).toMatchObject({
      moderationStatus: "quarantined",
    });
    expect((await row(t, quarantined.id))!).not.toHaveProperty("removedReason");
    expect(await blobExists(t, quarantined.fileId)).toBe(true);
    // Staged: gone with its blob.
    expect(await row(t, staged.id)).toBeNull();
    expect(await blobExists(t, staged.fileId)).toBe(false);
  });

  test("a held photo's purge finishes once its report is decided", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    const photo = await deliveredPhoto(t, threadId, alice);
    await asBob(t).mutation(api.reports.fileReport.fileReport, {
      targetKind: "attachment",
      targetId: photo.id,
      reason: "spam_scam",
    });
    expect((await row(t, photo.id))!.evidenceHold).toBe(true);
    await deleteAlice(t);
    expect(await blobExists(t, photo.fileId)).toBe(true);

    const report = await t.run((ctx) => ctx.db.query("reports").first());
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: report!._id,
      decision: "dismissed",
      statementOfReasons: "No violation found.",
    });
    expect(await row(t, photo.id)).toMatchObject({
      moderationStatus: "removed",
      removedReason: "account_deleted",
    });
    expect((await row(t, photo.id))!.evidenceHold).toBeUndefined();
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("a delivered location loses its map, coordinates and label", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await seed(t);
    const location = await deliveredLocation(t, threadId, alice);
    await deleteAlice(t);

    const after = await row(t, location.id);
    expect(after).toMatchObject({
      kind: "location",
      precision: "exact",
      removedReason: "account_deleted",
      removedAt: expect.any(Number),
    });
    for (const field of ["lat", "lng", "label"]) {
      expect(after).not.toHaveProperty(field);
    }
    expect(await blobExists(t, location.mapFileId)).toBe(false);
    const [message] = await bobThread(t, threadId);
    expect(message.kind).toBe("location");
    expect(message.attachment).toBeUndefined();
  });

  test("the other participant's photos are untouched", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await seed(t);
    const photo = await deliveredPhoto(t, threadId, bob);
    await deleteAlice(t);
    expect(await row(t, photo.id)).toMatchObject({
      moderationStatus: "approved",
    });
    expect(await blobExists(t, photo.fileId)).toBe(true);
  });
});

describe("account deletion: blocks, reveals, reports, rate limits", () => {
  test("blocks both ways and the member's own reveals, GPS views and counters are deleted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, threadId } = await seed(t);
    const bobPhoto = await deliveredPhoto(t, threadId, bob);
    await t.run(async (ctx) => {
      await ctx.db.insert("blocks", {
        blockerId: alice,
        blockedId: carol,
        createdAt: 1,
      });
      await ctx.db.insert("blocks", {
        blockerId: carol,
        blockedId: alice,
        createdAt: 1,
      });
      await ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: carol,
        createdAt: 1,
      });
      await ctx.db.insert("messageImageReveals", {
        attachmentId: bobPhoto.id,
        viewerId: alice,
        revealedAt: 1,
      });
      for (const memberId of [alice, bob]) {
        await ctx.db.insert("locationGpsViews", {
          memberId,
          threadAggregateId: threadId,
          lat: 52.37,
          lng: 4.895,
          createdAt: 1,
        });
      }
      for (const key of [
        `messagePost:${alice}`,
        `reportFile:${alice}`,
        `messagePost:${bob}`,
        "maptiler:global:hour",
      ]) {
        await ctx.db.insert("rateLimits", { key, windowStart: 1, count: 1 });
      }
    });
    await deleteAlice(t);

    const left = await t.run(async (ctx) => ({
      blocks: await ctx.db.query("blocks").collect(),
      reveals: await ctx.db.query("messageImageReveals").collect(),
      gpsViews: await ctx.db.query("locationGpsViews").collect(),
      limits: await ctx.db.query("rateLimits").collect(),
    }));
    expect(left.blocks.map((b) => [b.blockerId, b.blockedId])).toEqual([
      [bob, carol],
    ]);
    expect(left.reveals).toEqual([]);
    expect(left.gpsViews.map((g) => g.memberId)).toEqual([bob]);
    // The deployment-wide MapTiler budget is not the member's: it stays.
    expect(left.limits.map((l) => l.key)).toEqual([
      `messagePost:${bob}`,
      "maptiler:global:hour",
    ]);
  });

  test("per-pair counters naming them on either side are deleted; other members' stay", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    const follow = (subject: string, followeeId: Id<"users">) =>
      t
        .withIdentity({ subject })
        .mutation(api.social.followMember.followMember, { followeeId });
    await follow("clerk_alice", carol);
    await follow("clerk_carol", alice);
    await follow("clerk_bob", carol);
    await settleDueJobs(t);
    const keysBefore = await t.run(async (ctx) =>
      (await ctx.db.query("rateLimits").collect()).map((row) => row.key),
    );
    expect(keysBefore).toEqual(
      expect.arrayContaining([
        `followPair:${alice}:${carol}`,
        `followPair:${carol}:${alice}`,
        `followPair:${bob}:${carol}`,
      ]),
    );

    await deleteAlice(t);

    const keys = await t.run(async (ctx) =>
      (await ctx.db.query("rateLimits").collect()).map((row) => row.key),
    );
    expect(keys.filter((key) => key.includes(alice))).toEqual([]);
    expect(keys).toContain(`followPair:${bob}:${carol}`);
  });

  test("per-pair counters past one batch are deleted over several runs", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("rateLimits", {
          key: `followNotice:email:new_follower:${bob}:actor-${i}`,
          windowStart: 1,
          count: 1,
          pairActorId: alice,
        });
        await ctx.db.insert("rateLimits", {
          key: `householdInvitePair:household-${i}:${alice}`,
          windowStart: 1,
          count: 1,
          pairTargetId: alice,
        });
      }
    });
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: alice, phase: "rateLimits", batchSize: 2 },
    );
    expect(
      await t.run((ctx) => ctx.db.query("rateLimits").collect()),
    ).toHaveLength(6);
    await settleDueJobs(t);
    expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toEqual(
      [],
    );
  });

  test("reports they filed are anonymised; reports about them are kept", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    const [filed, about] = await t.run(async (ctx) => [
      await ctx.db.insert("reports", {
        reporterId: alice,
        targetKind: "user",
        targetId: bob,
        reportedUserId: bob,
        reason: "illegal",
        details: "Selling stolen puzzles",
        illegalNotice: {
          notifierName: "Alice A.",
          notifierEmail: "alice@elsewhere.test",
          goodFaith: true,
        },
        evidence: {},
        status: "open",
        createdAt: 1,
      }),
      await ctx.db.insert("reports", {
        reporterId: carol,
        targetKind: "user",
        targetId: alice,
        reportedUserId: alice,
        reason: "harassment_hate",
        evidence: {},
        status: "open",
        createdAt: 1,
      }),
    ]);
    await deleteAlice(t);

    const filedAfter = await t.run((ctx) => ctx.db.get(filed));
    expect(filedAfter).not.toHaveProperty("reporterId");
    expect(filedAfter).toMatchObject({
      reporterAnonymisedAt: expect.any(Number),
      illegalNotice: { goodFaith: true },
      reportedUserId: bob,
      status: "open",
    });
    expect(filedAfter!.illegalNotice).toEqual({ goodFaith: true });
    expect(await t.run((ctx) => ctx.db.get(about))).toMatchObject({
      reporterId: carol,
      reportedUserId: alice,
      status: "open",
    });

    // The admin still sees and decides it; the anonymised reporter gets no notice.
    const detail = await asAdmin(t).query(api.admin.getReport.getReport, {
      reportId: filed,
    });
    expect(detail.reporterLabel).toBeNull();
    expect(detail.illegalNotice).toEqual({ goodFaith: true });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: filed,
      decision: "warned",
      statementOfReasons: "Listing rules apply.",
    });
    const notified = await t.run((ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notified.map((n) => [n.userId, n.type])).toEqual([
      [bob, "member_warned"],
    ]);
  });

  test("the purge runs in batches", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, threadId } = await seed(t);
    const staged = [];
    for (let i = 0; i < 5; i++) {
      staged.push(await undeliveredPhoto(t, threadId, alice));
    }
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("blocks", {
          blockerId: alice,
          blockedId: carol,
          createdAt: i,
        });
      }
    });
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: alice, batchSize: 2 },
    );
    // One batch ran: two photos gone, three left for the next runs.
    expect(
      await t.run((ctx) => ctx.db.query("messageAttachments").collect()),
    ).toHaveLength(3);
    await settleDueJobs(t);

    const runs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("purgeMemberMessagingData"),
      ),
    );
    // attachments 3 more runs (2+2+1, then the empty tail page), then reveals, gpsViews,
    // blocksOut (2 runs), blocksIn, reports, rateLimits.
    expect(runs.length).toBeGreaterThan(6);
    const left = await t.run(async (ctx) => ({
      attachments: await ctx.db.query("messageAttachments").collect(),
      blocks: await ctx.db.query("blocks").collect(),
    }));
    expect(left).toEqual({ attachments: [], blocks: [] });
    for (const photo of staged) {
      expect(await blobExists(t, photo.fileId)).toBe(false);
    }
  });
});

// The phases after "presence" need the presence component registered.
const newPurgeT = (): T => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

// The wide events a test run logged under `event`.
const loggedEvents = (event: string): Record<string, unknown>[] =>
  vi
    .mocked(console.log)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event === event);

describe("account deletion: the legacy exchange chat", () => {
  // Alice and Bob chatted about a trade in the legacy `messages` table, and conversation/backfill
  // copied that chat into their exchange thread. Two later legacy rows between Alice and Carol were
  // never copied, and Bob and Carol have a copied legacy chat of their own.
  const seedLegacy = async (t: T) => {
    const s = await seed(t);
    const legacy = await t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: s.bob,
        createdAt: 1,
        updatedAt: 1,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: s.bob,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      });
      const exchange = (
        initiatorId: Id<"users">,
        recipientId: Id<"users">,
        aggregateId: string,
      ) =>
        ctx.db.insert("exchanges", {
          aggregateId,
          initiatorId,
          recipientId,
          type: "trade",
          requestedPuzzleId: copy,
          status: "completed",
          createdAt: 1,
          updatedAt: 1,
        });
      const message = (
        exchangeId: Id<"exchanges">,
        senderId: Id<"users">,
        receiverId: Id<"users">,
        content: string,
      ) =>
        ctx.db.insert("messages", {
          exchangeId,
          senderId,
          receiverId,
          content,
          messageType: "text",
          isRead: true,
          createdAt: 1,
        });
      const ab = await exchange(s.alice, s.bob, "exch-ab");
      const bc = await exchange(s.bob, s.carol, "exch-bc");
      return {
        ac: await exchange(s.alice, s.carol, "exch-ac"),
        aliceToBob: await message(ab, s.alice, s.bob, "Is it complete?"),
        bobToAlice: await message(ab, s.bob, s.alice, "Every piece"),
        bobToCarol: await message(bc, s.bob, s.carol, "Still available"),
      };
    });
    await t.mutation(internal.conversation.backfill.run, {});
    const uncopied = await t.run(async (ctx) => {
      const message = (senderId: Id<"users">, receiverId: Id<"users">) =>
        ctx.db.insert("messages", {
          exchangeId: legacy.ac,
          senderId,
          receiverId,
          content: "Not copied yet",
          messageType: "text",
          isRead: true,
          createdAt: 2,
        });
      return {
        aliceToCarol: await message(s.alice, s.carol),
        carolToAlice: await message(s.carol, s.alice),
      };
    });
    return { ...s, ...legacy, ...uncopied };
  };

  test("copied rows go both ways; rows never copied stay and are counted", async () => {
    const t = newPurgeT();
    const s = await seedLegacy(t);
    await deleteAlice(t);

    const left = await t.run(async (ctx) =>
      (await ctx.db.query("messages").collect()).map((m) => m._id).sort(),
    );
    expect(left).toEqual([s.bobToCarol, s.aliceToCarol, s.carolToAlice].sort());
    // Bob still reads the copied chat in the exchange thread.
    const copies = await t.run(async (ctx) =>
      Promise.all(
        [s.aliceToBob, s.bobToAlice].map((id) =>
          ctx.db
            .query("threadMessages")
            .withIndex("by_message_id", (q) =>
              q.eq("messageId", `legacy-${id}`),
            )
            .unique(),
        ),
      ),
    );
    expect(copies.map((m) => m?.body)).toEqual([
      "Is it complete?",
      "Every piece",
    ]);
    const kept = loggedEvents("conversation.purgeLegacyMessages").reduce(
      (sum, line) => sum + Number(line.kept_unmigrated),
      0,
    );
    expect(kept).toBe(2);
  });

  test("legacyMessagesStatus pages the table and counts the rows not copied", async () => {
    const t = newPurgeT();
    await seedLegacy(t);
    let cursor: string | null = null;
    let scanned = 0;
    let unmigrated = 0;
    for (;;) {
      const page: {
        scanned: number;
        unmigrated: number;
        isDone: boolean;
        continueCursor: string;
      } = await t.query(internal.conversation.backfill.legacyMessagesStatus, {
        paginationOpts: { numItems: 2, cursor },
      });
      scanned += page.scanned;
      unmigrated += page.unmigrated;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect({ scanned, unmigrated }).toEqual({ scanned: 5, unmigrated: 2 });
  });
});

describe("account deletion: a DM or exchange thread nobody is left in", () => {
  const deleteMember = async (t: T, clerkId: string) => {
    await t.mutation(internal.users.deleteUser, { id: clerkId });
    await settleDueJobs(t);
  };

  // Everything a thread holds, by thread.
  const threadData = (t: T, threadId: string) =>
    t.run(async (ctx) => ({
      thread: await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", threadId))
        .unique(),
      messages: await ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
      attachments: await ctx.db
        .query("messageAttachments")
        .withIndex("by_thread_uploader", (q) =>
          q.eq("threadAggregateId", threadId),
        )
        .collect(),
      participants: await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
      typing: await ctx.db
        .query("typingIndicators")
        .withIndex("by_thread", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
    }));

  // Alice and Carol's exchange thread, as the conversation subscriber writes it.
  const exchangeThread = (
    t: T,
    s: { alice: Id<"users">; carol: Id<"users"> },
  ) =>
    t.run(async (ctx) => {
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: s.carol,
        createdAt: 1,
        updatedAt: 1,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: s.carol,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      });
      const exchangeId = await ctx.db.insert("exchanges", {
        initiatorId: s.alice,
        recipientId: s.carol,
        type: "trade",
        requestedPuzzleId: copy,
        status: "completed",
        createdAt: 1,
        updatedAt: 1,
      });
      const aggregateId = "thread-exchange-ac";
      const participants = [s.alice, s.carol];
      await ctx.db.insert("threads", {
        aggregateId,
        subjectKind: "exchange",
        exchangeId,
        participants,
        participantsKey: participants.map(String).sort().join("|"),
        createdAt: 1,
      });
      for (const memberId of participants) {
        await ctx.db.insert("threadParticipants", {
          threadAggregateId: aggregateId,
          memberId,
        });
      }
      for (const [i, authorId] of participants.entries()) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: aggregateId,
          messageId: `msg-ac-${i}`,
          authorId,
          kind: "text",
          body: "Swap on Saturday?",
          sentAt: 10 + i,
        });
      }
      return aggregateId;
    });

  const post = (t: T, who: "alice" | "bob", threadId: string, body: string) =>
    (who === "alice" ? asAlice(t) : asBob(t)).mutation(
      api.conversation.postMessage.postMessage,
      { threadId, kind: "text", body },
    );

  test("the DM stays while Bob is here and goes, whole, once he is deleted too", async () => {
    const t = newPurgeT();
    const s = await seed(t);
    await post(t, "alice", s.threadId, "See you Saturday");
    await post(t, "bob", s.threadId, "Great");
    const bobsPhoto = await deliveredPhoto(t, s.threadId, s.bob);
    await asBob(t).mutation(api.conversation.setTyping.setTyping, {
      threadId: s.threadId,
    });

    await deleteAlice(t);
    const kept = await threadData(t, s.threadId);
    expect(kept.thread).not.toBeNull();
    expect(kept.messages.map((m) => m.body).sort()).toEqual([
      "",
      "Great",
      "See you Saturday",
    ]);
    expect(kept.participants).toHaveLength(2);
    expect(await blobExists(t, bobsPhoto.fileId)).toBe(true);

    await deleteMember(t, "clerk_bob");
    expect(await threadData(t, s.threadId)).toEqual({
      thread: null,
      messages: [],
      attachments: [],
      participants: [],
      typing: [],
    });
    expect(await blobExists(t, bobsPhoto.fileId)).toBe(false);
  });

  test("an exchange thread goes once both parties are deleted", async () => {
    const t = newPurgeT();
    const s = await seed(t);
    const threadId = await exchangeThread(t, s);
    await deleteAlice(t);
    expect((await threadData(t, threadId)).messages).toHaveLength(2);
    await deleteMember(t, "clerk_carol");
    expect(await threadData(t, threadId)).toMatchObject({
      thread: null,
      messages: [],
      participants: [],
    });
  });

  test.each(["before", "after"] as const)(
    "a thread with a tombstoned participant (open CSAM escalation) is kept: Bob tombstoned %s Alice is deleted",
    async (bobGoes) => {
      const t = newPurgeT();
      const s = await seed(t);
      await post(t, "bob", s.threadId, "Hello");
      await t.run((ctx) =>
        ctx.db.insert("csamEscalations", {
          table: "messageAttachments",
          rowId: "x",
          uploaderId: s.bob,
          md5: "m",
          sha1: "s",
          provider: "offlimits",
          matchedAt: 1,
          status: "open",
        }),
      );
      if (bobGoes === "before") await deleteMember(t, "clerk_bob");
      await deleteAlice(t);
      if (bobGoes === "after") await deleteMember(t, "clerk_bob");
      expect((await t.run((ctx) => ctx.db.get(s.bob)))?.isActive).toBe(false);

      const kept = await threadData(t, s.threadId);
      expect(kept.thread).not.toBeNull();
      expect(kept.messages.map((m) => m.body)).toEqual(["Hello"]);
    },
  );

  test("a photo an open report holds survives the thread, blobs included", async () => {
    const t = newPurgeT();
    const s = await seed(t);
    const held = await deliveredPhoto(t, s.threadId, s.bob, {
      evidenceHold: true,
    });
    const quarantined = await undeliveredPhoto(
      t,
      s.threadId,
      s.bob,
      "quarantined",
    );
    await deleteAlice(t);
    await deleteMember(t, "clerk_bob");

    const after = await threadData(t, s.threadId);
    expect(after.thread).toBeNull();
    expect(after.messages).toEqual([]);
    expect(after.attachments.map((a) => a._id).sort()).toEqual(
      [held.id, quarantined.id].sort(),
    );
    expect(await blobExists(t, held.fileId)).toBe(true);
    expect(await blobExists(t, quarantined.fileId)).toBe(true);
  });

  test("a long thread goes over several runs", async () => {
    const t = newPurgeT();
    const s = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 2 * PURGE_BATCH_SIZE + 10; i++) {
        await ctx.db.insert("threadMessages", {
          threadAggregateId: s.threadId,
          messageId: `msg-long-${i}`,
          authorId: i % 2 === 0 ? s.alice : s.bob,
          kind: "text",
          body: `message ${i}`,
          sentAt: 100 + i,
        });
      }
    });
    await deleteAlice(t);
    await deleteMember(t, "clerk_bob");

    expect((await threadData(t, s.threadId)).thread).toBeNull();
    const runs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("purgeOrphanThread"),
      ),
    );
    expect(runs.length).toBeGreaterThanOrEqual(3);
  });
});
