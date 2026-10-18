import type {
  InboxThreadView,
  MessageAttachmentView,
  ThreadMessageView,
} from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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
    expect(inbox[0].subject.otherMember).toMatchObject({
      anonymous: true,
      departed: true,
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
