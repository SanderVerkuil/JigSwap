import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Message image attachments (spec 2.1/2.2, R.1-R.3, R.10, R.12): staging checks, the deferred
// append (nothing reaches the recipient before delivery, and delivery happens exactly once),
// verdict bands and the per-viewer blur, the sender's outbox, the review appeal and its admin
// gate, attachment reports and the 24 h expiry. The shared pipeline runs for real; the classifier
// (Hugging Face) and the CSAM hash service (Offlimits HCS) are a routed fake `fetch`, and some
// tests drive the pipeline's own store steps directly (a late verdict, a hash re-check).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// What the fakes answer: the classifier's NSFW score, and HCS's verdict (or an HTTP status).
const fakes: { score: number; hcs: "match" | "no_match" | number } = {
  score: 0.01,
  hcs: "no_match",
};

beforeEach(() => {
  fakes.score = 0.01;
  fakes.hcs = "no_match";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === HCS_URL) {
        return typeof fakes.hcs === "number"
          ? new Response("unavailable", { status: fakes.hcs })
          : new Response(JSON.stringify({ match: fakes.hcs === "match" }), {
              status: 200,
            });
      }
      if (url.includes(HF_HOST)) {
        return new Response(
          JSON.stringify([
            { label: "nsfw", score: fakes.score },
            { label: "normal", score: 1 - fakes.score },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    await mkUser("clerk_ada");
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 1,
    });
    return { alice, bob, carol };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: T) => t.withIdentity({ subject: "clerk_carol" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

// Alice and Bob's DM. Opened while they follow each other (the connection policy).
const openThread = async (t: T) => {
  const { alice, bob, carol } = await seed(t);
  const threadId = await asAlice(t).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: bob },
  );
  return { alice, bob, carol, threadId };
};

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

// Store bytes as an upload. convex-test does not record an upload's content type on the
// `_storage` row (the real upload endpoint does), so set it the way an HTTP upload would.
const storeUpload = async (
  t: T,
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
) =>
  t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([bytes], { type }));
    // oxlint-disable-next-line typescript/no-explicit-any
    await (ctx.db as any).patch(id, { contentType: type });
    return id as Id<"_storage">;
  });

// A real, unique JPEG so the pipeline's re-encode runs.
const storeJpeg = async (t: T, type = "image/jpeg") => {
  const image = new Jimp({
    width: 8,
    height: 6,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  return storeUpload(
    t,
    new Uint8Array(await image.getBuffer("image/jpeg")),
    type,
  );
};

const stage = async (t: T, threadId: string, storageId?: Id<"_storage">) =>
  asAlice(t).mutation(api.conversation.stageMessageImage.stageMessageImage, {
    threadId,
    storageId: storageId ?? (await storeJpeg(t)),
    width: 800,
    height: 600,
  });

const send = (
  t: T,
  threadId: string,
  attachmentIds: Id<"messageAttachments">[],
  caption?: string,
) =>
  asAlice(t).mutation(api.conversation.sendStagedImages.sendStagedImages, {
    threadId,
    attachmentIds,
    ...(caption !== undefined && { caption }),
  });

const attachment = (t: T, id: Id<"messageAttachments">) =>
  t.run((ctx) => ctx.db.get(id));

const messageRows = (t: T, threadId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
      .collect(),
  );

const threadOf = (
  t: T,
  as: (t: T) => ReturnType<T["withIdentity"]>,
  id: string,
) =>
  as(t).query(api.conversation.getThreadMessages.getThreadMessages, {
    threadId: id,
  });

const notificationsOf = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect(),
  );

const outbox = (t: T, threadId: string) =>
  asAlice(t).query(
    api.conversation.listMyPendingAttachments.listMyPendingAttachments,
    { threadId },
  );

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const store = internal.conversation.attachmentModerationStore;

describe("staging a photo", () => {
  test("a participant stages a fresh JPEG: pending, unpublished, pipeline and expiry scheduled", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    const row = await attachment(t, id);
    expect(row).toMatchObject({
      kind: "image",
      threadAggregateId: threadId,
      uploaderId: alice,
      moderationStatus: "pending",
      width: 800,
      height: 600,
      contentType: "image/jpeg",
    });
    expect(typeof row!.hashCheckPendingSince).toBe("number");
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.map((job) => job.name).sort()).toEqual([
      "conversation/attachmentModerationStore:expireStaged",
      "conversation/moderateMessageImage:moderateMessageImage",
    ]);
    await settleDueJobs(t);
  });

  test("a non-participant can't get an upload URL or stage", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expect(
      asCarol(t).mutation(
        api.conversation.generateMessageUploadUrl.generateMessageUploadUrl,
        { threadId },
      ),
    ).rejects.toThrow(/NotParticipant/);
    await expect(
      asCarol(t).mutation(
        api.conversation.stageMessageImage.stageMessageImage,
        {
          threadId,
          storageId: await storeJpeg(t),
          width: 10,
          height: 10,
        },
      ),
    ).rejects.toThrow(/NotParticipant/);
  });

  test.each(["alice blocks bob", "bob blocks alice"])(
    "%s: no upload URL, no staging (CannotReply)",
    async (direction) => {
      const t = convexTest(schema, modules);
      const { alice, bob, threadId } = await openThread(t);
      const [blockerId, blockedId] =
        direction === "alice blocks bob" ? [alice, bob] : [bob, alice];
      await t.run((ctx) =>
        ctx.db.insert("blocks", { blockerId, blockedId, createdAt: 1 }),
      );
      await expect(
        asAlice(t).mutation(
          api.conversation.generateMessageUploadUrl.generateMessageUploadUrl,
          { threadId },
        ),
      ).rejects.toThrow(/CannotReply/);
      await expect(stage(t, threadId)).rejects.toThrow(/CannotReply/);
    },
  );

  test("staging is rate limited (imageStage), and so are upload URLs (imageUploadUrl)", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    await t.run(async (ctx) => {
      for (const name of ["imageStage", "imageUploadUrl"] as const) {
        await ctx.db.insert("rateLimits", {
          key: `${name}:${alice}`,
          windowStart: Date.now(),
          count: RATE_LIMITS[name].max,
        });
      }
    });
    await expect(stage(t, threadId)).rejects.toThrow(/RateLimited/);
    await expect(
      asAlice(t).mutation(
        api.conversation.generateMessageUploadUrl.generateMessageUploadUrl,
        { threadId },
      ),
    ).rejects.toThrow(/RateLimited/);
  });

  test("refuses an upload over 10 MB, of another type, or older than 15 minutes", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const big = await storeUpload(
      t,
      new Uint8Array(10 * 1024 * 1024 + 1),
      "image/jpeg",
    );
    await expect(stage(t, threadId, big)).rejects.toThrow(/ImageTooLarge/);
    await expect(
      stage(t, threadId, await storeJpeg(t, "image/gif")),
    ).rejects.toThrow(/UnsupportedImageType/);
    const old = await storeJpeg(t);
    const later = Date.now() + 16 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await expect(stage(t, threadId, old)).rejects.toThrow(/UploadExpired/);
  });

  test("refuses bad sizes, an already-claimed blob and a CSAM-preserved blob", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    await expect(
      asAlice(t).mutation(
        api.conversation.stageMessageImage.stageMessageImage,
        {
          threadId,
          storageId: await storeJpeg(t),
          width: 0,
          height: 10,
        },
      ),
    ).rejects.toThrow(/InvalidImageSize/);
    const blob = await storeJpeg(t);
    await stage(t, threadId, blob);
    await expect(stage(t, threadId, blob)).rejects.toThrow(/InvalidUpload/);

    const preserved = await storeJpeg(t);
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "completionImages",
        rowId: "x",
        uploaderId: alice,
        fileId: preserved,
        md5: "m",
        sha1: "s",
        provider: "offlimits",
        matchedAt: 1,
        status: "open",
      }),
    );
    await expect(stage(t, threadId, preserved)).rejects.toThrow(
      /InvalidUpload/,
    );
    await settleDueJobs(t);
  });

  test.each([
    ["MODERATION_PROVIDER=none", "MODERATION_PROVIDER", "none"],
    ["a missing classifier token", "HF_MODERATION_TOKEN", ""],
  ])(
    "photos are off with %s (ImagesUnavailable)",
    async (_label, name, value) => {
      vi.stubEnv(name, value);
      const t = convexTest(schema, modules);
      const { threadId } = await openThread(t);
      await expect(
        asAlice(t).mutation(
          api.conversation.generateMessageUploadUrl.generateMessageUploadUrl,
          { threadId },
        ),
      ).rejects.toThrow(/ImagesUnavailable/);
      await expect(stage(t, threadId)).rejects.toThrow(/ImagesUnavailable/);
    },
  );
});

describe("deferred append", () => {
  test("the recipient sees nothing until the photo is deliverable AND sent, then exactly one message", async () => {
    // HCS unreachable: the classifier approves, but the hash gate stays closed.
    fakes.hcs = 503;
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id], "  Look!  ");
    await settleDueJobs(t);

    expect((await attachment(t, id))!.moderationStatus).toBe("approved");
    expect(await threadOf(t, asBob, threadId)).toEqual([]);
    const [inboxBefore] = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(inboxBefore).toMatchObject({ lastMessage: null, unreadCount: 0 });
    expect(await notificationsOf(t, bob)).toEqual([]);
    // The sender's outbox: pending, no image yet (not hash-cleared), the blurhash instead.
    const [pending] = await outbox(t, threadId);
    expect(pending).toMatchObject({ status: "pending", sendRequested: true });
    expect(pending).not.toHaveProperty("thumbUrl");
    expect(typeof pending.blurhash).toBe("string");

    // The scheduled re-check clears the gate: delivered now.
    await t.mutation(store.setHashCheck, { imageId: id, status: "no_match" });
    await settleDueJobs(t);
    const messages = await threadOf(t, asBob, threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      isMine: false,
      kind: "image",
      body: "Look!",
      attachmentId: id,
      attachment: { status: "ready", w: 800, h: 600 },
    });
    expect(messages[0].attachment!.url).toEqual(expect.any(String));
    const [inbox] = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(inbox).toMatchObject({
      lastMessage: { kind: "image", body: "Look!" },
      unreadCount: 1,
    });
    expect(inbox.lastMessage).not.toHaveProperty("attachmentId");
    expect((await notificationsOf(t, bob)).map((n) => n.type)).toEqual([
      "message_received",
    ]);
    expect(await outbox(t, threadId)).toEqual([]);

    // Double verdict / double clear: still exactly one message.
    await t.mutation(store.setModerationVerdict, {
      imageId: id,
      moderationStatus: "approved",
      moderationScore: 0.01,
    });
    await t.mutation(store.setHashCheck, { imageId: id, status: "no_match" });
    expect(await messageRows(t, threadId)).toHaveLength(1);
  });

  test("a photo that is deliverable but not sent stays out of the thread", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    expect((await attachment(t, id))!.hashCheckedAt).toEqual(
      expect.any(Number),
    );
    expect(await threadOf(t, asBob, threadId)).toEqual([]);
    expect(await notificationsOf(t, bob)).toEqual([]);
    const [staged] = await outbox(t, threadId);
    expect(staged).toMatchObject({ status: "pending", sendRequested: false });
    expect(staged.thumbUrl).toEqual(expect.any(String));
  });

  test("a batch arrives in send order; the caption rides on the last photo", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const first = await stage(t, threadId);
    const second = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [second, first], "two photos");
    const messages = await threadOf(t, asBob, threadId);
    expect(messages.map((m) => [m.attachmentId, m.body])).toEqual([
      [second, ""],
      [first, "two photos"],
    ]);
  });

  test("a rejected last photo: the others are delivered, its caption never is", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const ok = await stage(t, threadId);
    await settleDueJobs(t);
    fakes.score = 0.97;
    const flagged = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [ok, flagged], "for you");
    const messages = await threadOf(t, asBob, threadId);
    expect(messages.map((m) => [m.kind, m.body])).toEqual([["image", ""]]);
    expect(JSON.stringify(await messageRows(t, threadId))).not.toContain(
      "for you",
    );
  });

  test("a block before delivery drops the undelivered photo", async () => {
    fakes.hcs = 503;
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: alice,
        createdAt: 1,
      }),
    );
    const fileId = (await attachment(t, id))!.fileId;
    await t.mutation(store.setHashCheck, { imageId: id, status: "no_match" });
    expect(await attachment(t, id)).toBeNull();
    expect(await blobExists(t, fileId)).toBe(false);
    expect(await messageRows(t, threadId)).toEqual([]);
  });
});

describe("never delivered", () => {
  test("rejected: no message; the sender gets an automated statement of reasons; audit stamped", async () => {
    fakes.score = 0.97;
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    await settleDueJobs(t);

    const row = (await attachment(t, id))!;
    expect(row.moderationStatus).toBe("rejected");
    expect(await blobExists(t, row.fileId)).toBe(true); // held for an appeal
    expect(await messageRows(t, threadId)).toEqual([]);
    expect(await notificationsOf(t, bob)).toEqual([]);
    const [notice] = await notificationsOf(t, alice);
    expect(notice).toMatchObject({
      type: "message_image_rejected",
      relatedId: threadId,
      params: expect.objectContaining({ automated: "true" }),
    });
    // Once only.
    await t.mutation(store.setHashCheck, { imageId: id, status: "no_match" });
    expect(await notificationsOf(t, alice)).toHaveLength(1);
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps).toEqual([
      expect.objectContaining({
        kind: "message_image_auto_rejected",
        targetId: id,
        targetLabel: "Message photo",
      }),
    ]);
    expect(stamps[0].actorId).toBeUndefined();
  });

  test("quarantined: no message; the sender's notice and outbox are exactly those of a flagged photo", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    fakes.score = 0.97;
    const flagged = await stage(t, threadId);
    await settleDueJobs(t);
    fakes.hcs = "match";
    const matched = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [flagged, matched]);
    await settleDueJobs(t);

    expect((await attachment(t, matched))!.moderationStatus).toBe(
      "quarantined",
    );
    expect(await messageRows(t, threadId)).toEqual([]);
    // Both get the same generic notice: a missing one would give the hash match away.
    const notices = await notificationsOf(t, alice);
    expect(notices.map((n) => n.type)).toEqual([
      "message_image_rejected",
      "message_image_rejected",
    ]);
    expect(notices[1].params).toEqual(notices[0].params);
    expect(notices[1].relatedId).toBe(notices[0].relatedId);
    const [a, b] = await outbox(t, threadId);
    const shape = ({ attachmentId: _id, createdAt: _at, ...rest }: typeof a) =>
      rest;
    expect(shape(b)).toEqual(shape(a));
    expect(shape(a)).toEqual({
      status: "rejected",
      reason: "flagged",
      sendRequested: true,
      w: 800,
      h: 600,
    });
  });

  test("a hash match found after the send (re-check) still sends the generic notice", async () => {
    fakes.hcs = 503;
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    const row = (await attachment(t, id))!;
    await t.mutation(store.quarantineImage, {
      imageId: id,
      fileId: row.fileId,
      uploaderId: alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    expect((await notificationsOf(t, alice)).map((n) => n.type)).toEqual([
      "message_image_rejected",
    ]);
    expect(await messageRows(t, threadId)).toEqual([]);
  });

  test("an unreadable upload is rejected as unreadable, never delivered", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const garbage = await storeUpload(
      t,
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      "image/jpeg",
    );
    const id = await stage(t, threadId, garbage);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    expect(await outbox(t, threadId)).toEqual([
      expect.objectContaining({ status: "rejected", reason: "unreadable" }),
    ]);
    expect(await messageRows(t, threadId)).toEqual([]);
  });
});

describe("blur, per viewer", () => {
  test("the 0.5-0.85 band is blurred for the recipient, unblurred for the sender", async () => {
    fakes.score = 0.6;
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    expect((await attachment(t, id))!.moderationStatus).toBe("blurred");
    const [forBob] = await threadOf(t, asBob, threadId);
    // Blurred means no URL at all until Bob taps Show (revealMessageImage).
    expect(forBob.attachment).toEqual({
      status: "blurred",
      w: 800,
      h: 600,
      blurhash: expect.any(String),
    });
    const [forAlice] = await threadOf(t, asAlice, threadId);
    expect(forAlice.attachment).toMatchObject({ status: "ready" });
  });

  test("unscored after the retries is delivered blurred and labelled not checked", async () => {
    fakes.hcs = 503; // keep the row pending while we stand in for the last retry
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: threadId,
        uploaderId: (await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_alice"))
          .unique())!._id,
        fileId: await ctx.storage.store(new Blob(["x"])),
        width: 4,
        height: 3,
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: "pending",
        hashCheckedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await send(t, threadId, [id]);
    expect(await threadOf(t, asBob, threadId)).toEqual([]);
    await t.mutation(store.setModerationVerdict, {
      imageId: id,
      moderationStatus: "unscored",
      moderationReason: "network",
      moderationAttempts: 4,
    });
    const [forBob] = await threadOf(t, asBob, threadId);
    expect(forBob.attachment).toMatchObject({
      status: "blurred",
      notChecked: true,
    });
  });

  test("a sender who is not the viewer's mutual follower is blurred at read time", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [id]);
    expect((await threadOf(t, asBob, threadId))[0].attachment!.status).toBe(
      "ready",
    );
    // Bob stops following Alice: the same stored photo is now blurred for him.
    await t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", bob).eq("followeeId", alice),
        )
        .first();
      await ctx.db.delete(edge!._id);
    });
    const [blurred] = await threadOf(t, asBob, threadId);
    expect(blurred.attachment!.status).toBe("blurred");
    expect(blurred.attachment).not.toHaveProperty("url");
    expect((await attachment(t, id))!.moderationStatus).toBe("approved");
    expect((await threadOf(t, asAlice, threadId))[0].attachment!.status).toBe(
      "ready",
    );
  });
});

describe("revealing a blurred photo", () => {
  const blurredPhoto = async (t: T) => {
    fakes.score = 0.6;
    const ctx = await openThread(t);
    const id = await stage(t, ctx.threadId);
    await settleDueJobs(t);
    await send(t, ctx.threadId, [id]);
    return { ...ctx, id };
  };
  const reveal = (
    as: (t: T) => ReturnType<T["withIdentity"]>,
    t: T,
    attachmentId: Id<"messageAttachments">,
  ) =>
    as(t).mutation(api.conversation.revealMessageImage.revealMessageImage, {
      attachmentId,
    });

  test("a tap returns the URL, and the reveal sticks for that viewer only", async () => {
    const t = convexTest(schema, modules);
    const { id, threadId } = await blurredPhoto(t);
    const { url } = await reveal(asBob, t, id);
    expect(url).toEqual(expect.any(String));
    const [forBob] = await threadOf(t, asBob, threadId);
    expect(forBob.attachment).toMatchObject({
      status: "ready",
      revealed: true,
      url,
    });
    const reveals = await t.run((ctx) =>
      ctx.db.query("messageImageReveals").collect(),
    );
    expect(reveals).toHaveLength(1);
    // Revealing again records nothing new.
    await reveal(asBob, t, id);
    expect(
      await t.run((ctx) => ctx.db.query("messageImageReveals").collect()),
    ).toHaveLength(1);
  });

  test("participants only, delivered photos only, not in a blocked pair, rate limited", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, id, threadId } = await blurredPhoto(t);
    await expect(reveal(asCarol, t, id)).rejects.toThrow(/AttachmentNotFound/);
    const staged = await stage(t, threadId);
    await settleDueJobs(t);
    await expect(reveal(asBob, t, staged)).rejects.toThrow(
      /AttachmentNotFound/,
    );
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `imageReveal:${bob}`,
        windowStart: Date.now(),
        count: RATE_LIMITS.imageReveal.max,
      }),
    );
    await expect(reveal(asBob, t, id)).rejects.toThrow(/RateLimited/);
    await t.run(async (ctx) => {
      await ctx.db.insert("blocks", {
        blockerId: alice,
        blockedId: bob,
        createdAt: 1,
      });
    });
    await expect(reveal(asBob, t, id)).rejects.toThrow(/AttachmentNotFound/);
  });
});

describe("sending", () => {
  test("only the uploader's unsent photos of this thread, 1 to 4, caption at most 1000", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await expect(send(t, threadId, [])).rejects.toThrow(
      /InvalidAttachmentCount/,
    );
    await expect(send(t, threadId, [id, id])).rejects.toThrow(
      /InvalidAttachmentCount/,
    );
    await expect(send(t, threadId, [id], "x".repeat(1001))).rejects.toThrow(
      /CaptionTooLong/,
    );
    await expect(
      asBob(t).mutation(api.conversation.sendStagedImages.sendStagedImages, {
        threadId,
        attachmentIds: [id],
      }),
    ).rejects.toThrow(/AttachmentNotFound/);
    await send(t, threadId, [id]);
    await expect(send(t, threadId, [id])).rejects.toThrow(/AttachmentNotFound/);
  });
});

describe("review appeal", () => {
  const rejectedPhoto = async (t: T) => {
    fakes.score = 0.97;
    const ctx = await openThread(t);
    const id = await stage(t, ctx.threadId);
    await settleDueJobs(t);
    await send(t, ctx.threadId, [id]);
    return { ...ctx, id };
  };
  const reviewQueue = (t: T) =>
    asAdmin(t).query(
      api.admin.listImageReviewRequests.listImageReviewRequests,
      {},
    );

  test("admins see a rejected photo only after the sender asks; non-admins never", async () => {
    const t = convexTest(schema, modules);
    const { id, threadId } = await rejectedPhoto(t);
    expect(await reviewQueue(t)).toEqual([]);
    await expect(
      asBob(t).mutation(
        api.conversation.requestImageReview.requestImageReview,
        {
          attachmentId: id,
        },
      ),
    ).rejects.toThrow(/AttachmentNotFound/);
    await asAlice(t).mutation(
      api.conversation.requestImageReview.requestImageReview,
      { attachmentId: id },
    );
    expect(await reviewQueue(t)).toEqual([
      expect.objectContaining({ attachmentId: id, url: expect.any(String) }),
    ]);
    await expect(
      asBob(t).query(
        api.admin.listImageReviewRequests.listImageReviewRequests,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asBob(t).mutation(api.admin.decideImageReview.decideImageReview, {
        attachmentId: id,
        decision: "restore",
      }),
    ).rejects.toThrow(/Forbidden/);
    expect((await outbox(t, threadId))[0]).toMatchObject({
      review: "requested",
    });
  });

  test("restore delivers the photo and stamps message_image_restored", async () => {
    const t = convexTest(schema, modules);
    const { id, threadId } = await rejectedPhoto(t);
    await asAlice(t).mutation(
      api.conversation.requestImageReview.requestImageReview,
      { attachmentId: id },
    );
    await asAdmin(t).mutation(api.admin.decideImageReview.decideImageReview, {
      attachmentId: id,
      decision: "restore",
    });
    const messages = await threadOf(t, asBob, threadId);
    expect(messages).toEqual([
      expect.objectContaining({ kind: "image", attachmentId: id }),
    ]);
    expect(await reviewQueue(t)).toEqual([]);
    const kinds = (
      await t.run((ctx) => ctx.db.query("moderationActions").collect())
    ).map((row) => row.kind);
    expect(kinds).toEqual([
      "message_image_auto_rejected",
      "message_image_restored",
    ]);
    await expect(
      asAdmin(t).mutation(api.admin.decideImageReview.decideImageReview, {
        attachmentId: id,
        decision: "uphold",
      }),
    ).rejects.toThrow(/NotAwaitingReview/);
  });

  test("uphold deletes the blob and the outbox shows the review upheld", async () => {
    const t = convexTest(schema, modules);
    const { id, threadId } = await rejectedPhoto(t);
    await asAlice(t).mutation(
      api.conversation.requestImageReview.requestImageReview,
      { attachmentId: id },
    );
    await asAdmin(t).mutation(api.admin.decideImageReview.decideImageReview, {
      attachmentId: id,
      decision: "uphold",
    });
    expect(await blobExists(t, (await attachment(t, id))!.fileId)).toBe(false);
    expect((await outbox(t, threadId))[0]).toMatchObject({
      status: "rejected",
      review: "upheld",
    });
    expect(await messageRows(t, threadId)).toEqual([]);
  });

  test("a quarantined photo takes the request like a rejected one but never reaches admins", async () => {
    fakes.hcs = "match";
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await asAlice(t).mutation(
      api.conversation.requestImageReview.requestImageReview,
      { attachmentId: id },
    );
    expect((await outbox(t, threadId))[0]).toMatchObject({
      status: "rejected",
      review: "requested",
    });
    expect(await reviewQueue(t)).toEqual([]);
  });
});

describe("reporting a photo", () => {
  const deliveredPhoto = async (t: T) => {
    const ctx = await openThread(t);
    const id = await stage(t, ctx.threadId);
    await settleDueJobs(t);
    await send(t, ctx.threadId, [id], "caption");
    return { ...ctx, id };
  };

  test("a participant's attachment report holds the photo and snapshots its id", async () => {
    const t = convexTest(schema, modules);
    const { alice, id, threadId } = await deliveredPhoto(t);
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "attachment", targetId: id, reason: "sexual" },
    );
    expect((await attachment(t, id))!.evidenceHold).toBe(true);
    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report).toMatchObject({
      targetKind: "attachment",
      targetId: id,
      reportedUserId: alice,
    });
    expect(report!.evidence.messages!.slice(-1)[0]).toMatchObject({
      attachmentId: id,
      body: "caption",
    });
    // The reporter's own view blurs the photo at once.
    expect((await threadOf(t, asBob, threadId))[0].attachment!.status).toBe(
      "blurred",
    );
    // Not a participant, or the uploader themself: NotFound.
    await expect(
      asCarol(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "attachment",
        targetId: id,
        reason: "sexual",
      }),
    ).rejects.toThrow(/NotFound/);
    await expect(
      asAlice(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "attachment",
        targetId: id,
        reason: "sexual",
      }),
    ).rejects.toThrow(/NotFound/);
  });

  test("an undelivered photo can't be reported", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await stage(t, threadId);
    await settleDueJobs(t);
    await expect(
      asBob(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "attachment",
        targetId: id,
        reason: "sexual",
      }),
    ).rejects.toThrow(/NotFound/);
  });

  test("content_removed removes the photo, tombstones its message and keeps the held blob", async () => {
    const t = convexTest(schema, modules);
    const { alice, id, threadId } = await deliveredPhoto(t);
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "attachment", targetId: id, reason: "sexual" },
    );
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Explicit photo",
    });
    const row = (await attachment(t, id))!;
    expect(row.moderationStatus).toBe("removed");
    expect(await blobExists(t, row.fileId)).toBe(true); // evidence hold
    for (const as of [asAlice, asBob]) {
      const [message] = await threadOf(t, as, threadId);
      expect(message).toMatchObject({ body: "", removed: true });
      expect(message).not.toHaveProperty("attachment");
      expect(message).not.toHaveProperty("attachmentId");
      const [inbox] = await as(t).query(
        api.conversation.getMyInbox.getMyInbox,
        {},
      );
      expect(inbox.lastMessage).toMatchObject({ removed: true, body: "" });
    }
    const notice = (await notificationsOf(t, alice)).find(
      (n) => n.type === "content_removed",
    );
    expect(notice!.params).toMatchObject({ restricted: "photo" });
  });

  test("a message report on an image message holds and, on removal, removes its photo", async () => {
    const t = convexTest(schema, modules);
    const { id, threadId } = await deliveredPhoto(t);
    const messageId = (await attachment(t, id))!.messageId!;
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "message", targetId: messageId, reason: "sexual" },
    );
    expect((await attachment(t, id))!.evidenceHold).toBe(true);
    // Reporting the photo's message blurs it for the reporter too, without a URL.
    const [forBob] = await threadOf(t, asBob, threadId);
    expect(forBob.attachment!.status).toBe("blurred");
    expect(forBob.attachment).not.toHaveProperty("url");
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Explicit photo",
    });
    expect((await attachment(t, id))!.moderationStatus).toBe("removed");
  });
});

describe("expiry", () => {
  test("a never-sent photo is deleted with its blob after 24 h; sent, rejected and held ones stay", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const unsent = await stage(t, threadId);
    const sent = await stage(t, threadId);
    const held = await stage(t, threadId);
    await settleDueJobs(t);
    fakes.score = 0.97;
    const rejected = await stage(t, threadId);
    await settleDueJobs(t);
    await send(t, threadId, [sent]);
    await t.run((ctx) => ctx.db.patch(held, { evidenceHold: true }));

    const unsentFile = (await attachment(t, unsent))!.fileId;
    for (const attachmentId of [unsent, sent, held, rejected]) {
      await t.mutation(store.expireStaged, { attachmentId });
    }
    expect(await attachment(t, unsent)).toBeNull();
    expect(await blobExists(t, unsentFile)).toBe(false);
    for (const kept of [sent, held, rejected]) {
      expect(await attachment(t, kept)).not.toBeNull();
    }
  });
});
