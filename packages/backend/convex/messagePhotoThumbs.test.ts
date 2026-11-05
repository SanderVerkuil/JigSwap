import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import {
  allRenditions,
  backfillDoneEvent,
  blobCount,
  blobExists,
  blobType,
  jpeg,
  scheduledRenditions,
  settleRenditions,
  storeBytes,
  storeWebp,
  urlOf,
} from "../test-fixtures/renditionJobs";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  asImage,
  messageAttachmentViews,
  type ImageAttachment,
} from "./conversation/messageAttachments";
import { checkImageBytes } from "./lib/imageModeration/guards";
import { enqueueImageModeration } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// Message photo thumbnails (PERF-C1, P-42): a photo gets ONE 640 px WebP in its own row
// (`thumbFileId`) only once it may be served to someone other than its sender (isServable:
// approved or blurred, hash-cleared, re-encoded). It never outlives the photo's blobs, and a CSAM
// match deletes it at once, whatever else holds the row. HCS and the classifier are a routed fake
// `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// A purge 30 days out must stay pending: Node fires a timeout above 2^31 - 1 ms at once.
const realSetTimeout = globalThis.setTimeout;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: () => void,
    ms?: number,
    ...rest: unknown[]
  ) =>
    (ms ?? 0) > MAX_TIMEOUT_MS
      ? realSetTimeout(() => {}, 0)
      : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type T = TestConvex<typeof schema>;
type PhotoFields = Partial<
  Pick<
    ImageAttachment,
    | "moderationStatus"
    | "moderationScore"
    | "hashCheckedAt"
    | "hashCheckPendingSince"
    | "hashCheckTimedOutAt"
    | "reencodedAt"
    | "hiddenFromSender"
    | "evidenceHold"
    | "reviewRequestedAt"
    | "messageId"
    | "width"
    | "thumbFileId"
  >
>;

const routedFetch = (hcs: "match" | "no_match" | number, nsfw = 0.01) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === HCS_URL) {
      if (typeof hcs === "number") {
        return new Response("unavailable", { status: hcs });
      }
      return new Response(JSON.stringify({ match: hcs === "match" }), {
        status: 200,
      });
    }
    if (url.includes(HF_HOST)) {
      return new Response(JSON.stringify([{ label: "nsfw", score: nsfw }]), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

// Alice and Bob follow each other and share a DM; Ada is a site admin.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mk("clerk_alice");
    const bob = await mk("clerk_bob");
    await mk("clerk_ada");
    for (const [followerId, followeeId] of [
      [alice, bob],
      [bob, alice],
    ]) {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    }
    return { alice, bob };
  });
  const threadId: string = await t
    .withIdentity({ subject: "clerk_alice" })
    .mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: ids.bob,
    });
  return { ...ids, threadId };
};
type Seeded = Awaited<ReturnType<typeof seed>>;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const generate = internal.lib.imageModeration.renditions.generateRenditions;
const backfill = internal.lib.imageModeration.renditions.backfillRenditions;
const record = internal.lib.imageModeration.renditionsStore.recordRenditions;
const store = internal.conversation.attachmentModerationStore;

// A photo that passed every gate; `fields` take one away.
const SERVABLE: PhotoFields = {
  moderationStatus: "approved",
  moderationScore: 0.01,
  hashCheckedAt: 1,
  reencodedAt: 1,
};

const seedPhoto = async (
  t: T,
  s: Seeded,
  fields: PhotoFields = SERVABLE,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
) => {
  const fileId = await storeBytes(t, bytes);
  const id = await t.run((ctx) =>
    ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: s.threadId,
      uploaderId: s.alice,
      fileId,
      byteSize: bytes.byteLength,
      contentType: "image/jpeg",
      moderationStatus: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    }),
  );
  return { id, fileId };
};

const photoRow = (t: T, id: Id<"messageAttachments">) =>
  t.run(async (ctx) => {
    const row = asImage(await ctx.db.get(id));
    if (!row) throw new Error("no such photo");
    return row;
  });

// A 1000 x 750 photo staged as an upload and sent through the pipeline.
const sendThroughPipeline = async (t: T, s: Seeded) => {
  const fileId = await storeBytes(t, await jpeg(1000, 750));
  const id = await t.run(async (ctx) => {
    const attachmentId = await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: s.threadId,
      uploaderId: s.alice,
      fileId,
      width: 1000,
      height: 750,
      byteSize: 1,
      contentType: "image/jpeg",
      moderationStatus: "pending",
      hashCheckPendingSince: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await enqueueImageModeration(ctx, "message", attachmentId);
    return attachmentId;
  });
  await asAlice(t).mutation(
    api.conversation.sendStagedImages.sendStagedImages,
    {
      threadId: s.threadId,
      attachmentIds: [id],
    },
  );
  await settleDueScheduled(t);
  return photoRow(t, id);
};

// Grey noise as a JPEG compressed hard: no WebP of it comes out clearly smaller.
const noisyJpeg = async (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4, 255);
  let seedValue = 7;
  for (let i = 0; i < data.length; i += 4) {
    seedValue = (seedValue * 1103515245 + 12345) & 0x7fffffff;
    data.fill(seedValue >> 23, i, i + 3);
  }
  return new Uint8Array(
    await Jimp.fromBitmap({ width, height, data }).getBuffer("image/jpeg", {
      quality: 5,
    }),
  );
};

describe("message photo thumbnails: made once the photo may be served", () => {
  test("a clean photo gets one 640 px WebP in its own row, from its clean blob", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const photo = await sendThroughPipeline(t, s);
    expect(photo.moderationStatus).toBe("approved");
    await settleRenditions(t);

    const row = await photoRow(t, photo._id);
    expect(row.thumbFileId).toBeDefined();
    expect(row.thumbCheckedAt).toEqual(expect.any(Number));
    expect(await blobType(t, row.thumbFileId!)).toBe("image/webp");
    expect(
      await t.run(async (ctx) => {
        const blob = await ctx.storage.get(row.thumbFileId!);
        return checkImageBytes(new Uint8Array(await blob!.arrayBuffer()));
      }),
    ).toMatchObject({ ok: true, format: "webp", width: 640, height: 480 });
    // In the row, not in the generic table: it lives and dies with the photo's blobs.
    expect(await allRenditions(t)).toEqual([]);
  });

  test("a photo in the sensitive band gets one too: it is served after Show", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.6));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const photo = await sendThroughPipeline(t, s);
    expect(photo.moderationStatus).toBe("blurred");
    await settleRenditions(t);

    expect((await photoRow(t, photo._id)).thumbFileId).toBeDefined();
  });

  test("a photo the classifier rejects gets none", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const photo = await sendThroughPipeline(t, s);
    expect(photo.moderationStatus).toBe("rejected");
    await settleRenditions(t);

    expect(await scheduledRenditions(t)).toEqual([]);
    expect((await photoRow(t, photo._id)).thumbFileId).toBeUndefined();
  });

  test("a photo approved while its hash check is out gets none until the check passes", async () => {
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const photo = await sendThroughPipeline(t, s);
    expect(photo.moderationStatus).toBe("approved");
    expect(photo.hashCheckedAt).toBeUndefined();
    expect(await scheduledRenditions(t)).toEqual([]);

    await t.mutation(store.setHashCheck, {
      imageId: photo._id,
      status: "no_match",
    });
    expect(await scheduledRenditions(t)).toEqual([photo.fileId]);
  });

  test.each<[string, PhotoFields]>([
    ["pending", { ...SERVABLE, moderationStatus: "pending" }],
    ["unscored", { ...SERVABLE, moderationStatus: "unscored" }],
    ["rejected", { ...SERVABLE, moderationStatus: "rejected" }],
    ["quarantined", { ...SERVABLE, moderationStatus: "quarantined" }],
    ["removed", { ...SERVABLE, moderationStatus: "removed" }],
    ["not hash-cleared", { ...SERVABLE, hashCheckedAt: undefined }],
    ["not re-encoded", { ...SERVABLE, reencodedAt: undefined }],
    ["hidden from its sender", { ...SERVABLE, hiddenFromSender: true }],
  ])("a %s photo gets none, and nothing is stored", async (_label, fields) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, fields, await jpeg(600, 450));
    const before = await blobCount(t);

    expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
      "not_eligible",
    );

    expect((await photoRow(t, photo.id)).thumbFileId).toBeUndefined();
    expect(await blobCount(t)).toBe(before);
  });

  test("a second run makes nothing new", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, SERVABLE, await jpeg(800, 600));

    expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
      "recorded",
    );
    const { thumbFileId } = await photoRow(t, photo.id);
    const before = await blobCount(t);

    expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
      "already_done",
    );

    expect((await photoRow(t, photo.id)).thumbFileId).toBe(thumbFileId);
    expect(await blobCount(t)).toBe(before);
  });

  test("a photo with nothing clearly smaller to offer is marked, so it is not decoded again", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, SERVABLE, await noisyJpeg(500, 400));
    const before = await blobCount(t);

    expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
      "recorded",
    );

    const row = await photoRow(t, photo.id);
    expect(row.thumbFileId).toBeUndefined();
    expect(row.thumbCheckedAt).toEqual(expect.any(Number));
    expect(await blobCount(t)).toBe(before);
    expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
      "already_done",
    );
  });

  test("an admin's approval, a waived hash check and a restored appeal schedule it", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const unscored = await seedPhoto(t, s, {
      ...SERVABLE,
      moderationStatus: "unscored",
      messageId: "m1",
    });
    const timedOut = await seedPhoto(t, s, {
      moderationStatus: "approved",
      moderationScore: 0.01,
      reencodedAt: 1,
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
      messageId: "m2",
    });
    const appealed = await seedPhoto(t, s, {
      ...SERVABLE,
      moderationStatus: "rejected",
      reviewRequestedAt: 1,
    });

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "message", imageId: unscored.id, decision: "approve" },
    );
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "message", imageId: timedOut.id, decision: "waive_hash_check" },
    );
    await asAdmin(t).mutation(api.admin.decideImageReview.decideImageReview, {
      attachmentId: appealed.id,
      decision: "restore",
    });

    expect(await scheduledRenditions(t)).toEqual([
      unscored.fileId,
      timedOut.fileId,
      appealed.fileId,
    ]);
  });

  test.each<[string, PhotoFields]>([
    ["quarantined", { moderationStatus: "quarantined" }],
    ["removed", { moderationStatus: "removed" }],
  ])(
    "a photo %s while it was encoded keeps nothing: the new blob is deleted",
    async (_label, change) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const photo = await seedPhoto(t, s);
      const thumb = await storeWebp(t, "late thumbnail");
      await t.run((ctx) => ctx.db.patch(photo.id, change));

      expect(
        await t.mutation(record, {
          sourceId: photo.fileId,
          width: 1000,
          height: 750,
          small: { fileId: thumb, width: 640, height: 480 },
        }),
      ).toBe(false);

      expect(await blobExists(t, thumb)).toBe(false);
      expect((await photoRow(t, photo.id)).thumbFileId).toBeUndefined();
    },
  );

  test("a photo that moved to another blob while it was encoded keeps nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s);
    const thumb = await storeWebp(t, "late thumbnail");
    const other = await storeBytes(t, new Uint8Array([4, 5, 6]));
    await t.run((ctx) => ctx.db.patch(photo.id, { fileId: other }));

    expect(
      await t.mutation(record, {
        sourceId: photo.fileId,
        width: 1000,
        height: 750,
        small: { fileId: thumb, width: 640, height: 480 },
      }),
    ).toBe(false);

    expect(await blobExists(t, thumb)).toBe(false);
  });
});

describe("message photo thumbnails: deleted with the photo", () => {
  const withThumb = async (t: T, s: Seeded, fields: PhotoFields = SERVABLE) => {
    const thumb = await storeWebp(t, "thumbnail");
    const photo = await seedPhoto(t, s, {
      ...fields,
      thumbFileId: thumb,
    });
    return { ...photo, thumb };
  };

  const quarantine = (
    t: T,
    s: Seeded,
    imageId: Id<"messageAttachments">,
    fileId: Id<"_storage">,
  ) =>
    t.mutation(store.quarantineImage, {
      imageId,
      fileId,
      uploaderId: s.alice,
      md5: "md5",
      sha1: "sha1",
      provider: "offlimits",
      originalDiscarded: false,
    });

  test("a hash match deletes it at once and forgets it; the escalation is still raised", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s);
    const preserved = await storeBytes(t, new Uint8Array([9, 9, 9]));

    await quarantine(t, s, photo.id, preserved);

    expect(await blobExists(t, photo.thumb)).toBe(false);
    const row: Doc<"messageAttachments"> = await photoRow(t, photo.id);
    expect(row).toMatchObject({
      moderationStatus: "quarantined",
      fileId: preserved,
    });
    expect(asImage(row)?.thumbFileId).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([
      expect.objectContaining({
        table: "messageAttachments",
        rowId: photo.id,
        fileId: preserved,
        status: "open",
      }),
    ]);
  });

  test("a hash match deletes it even while a report holds the photo", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s, { ...SERVABLE, evidenceHold: true });

    await quarantine(
      t,
      s,
      photo.id,
      await storeBytes(t, new Uint8Array([9, 9, 9])),
    );

    expect(await blobExists(t, photo.thumb)).toBe(false);
  });

  test("a moderator's removal deletes it with the photo", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const photo = await withThumb(t, s, {
      ...SERVABLE,
      moderationStatus: "unscored",
      messageId: "m1",
    });

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "message", imageId: photo.id, decision: "reject" },
    );

    expect(await blobExists(t, photo.thumb)).toBe(false);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("a report's hold keeps it exactly as long as the photo", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const photo = await withThumb(t, s, {
      ...SERVABLE,
      moderationStatus: "unscored",
      messageId: "m1",
      evidenceHold: true,
    });

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "message", imageId: photo.id, decision: "reject" },
    );

    expect(await blobExists(t, photo.thumb)).toBe(true);
    expect(await blobExists(t, photo.fileId)).toBe(true);
  });

  test("a photo that is never sent expires with its thumbnail", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s);

    await t.mutation(store.expireStaged, { attachmentId: photo.id });

    expect(await blobExists(t, photo.thumb)).toBe(false);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });
});

describe("message photo thumbnails: served only where the photo is", () => {
  const withThumb = async (t: T, s: Seeded, fields: PhotoFields = SERVABLE) => {
    const thumb = await storeWebp(t, "thumbnail");
    const photo = await seedPhoto(t, s, {
      width: 1000,
      ...fields,
      thumbFileId: thumb,
    });
    return {
      ...photo,
      thumb,
      url: await urlOf(t, photo.fileId),
      thumbUrl: await urlOf(t, thumb),
    };
  };

  const viewFor = (t: T, viewer: Id<"users">, id: Id<"messageAttachments">) =>
    t.run((ctx) => messageAttachmentViews(ctx, viewer)(id));

  const stopFollowing = (t: T, s: Seeded) =>
    t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", s.bob).eq("followeeId", s.alice),
        )
        .first();
      await ctx.db.delete(edge!._id);
    });

  // Expect no trace of the image: neither URL nor either storage id.
  const expectNothingOfIt = (
    view: unknown,
    photo: Awaited<ReturnType<typeof withThumb>>,
  ) => {
    const json = JSON.stringify(view);
    for (const secret of [
      photo.url,
      photo.thumbUrl,
      photo.fileId,
      photo.thumb,
    ]) {
      expect(json).not.toContain(secret);
    }
  };

  test("a reader who may see it gets the thumbnail, and the original for the viewer", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s);

    const view = await viewFor(t, s.bob, photo.id);
    expect(view).toEqual({
      status: "ready",
      w: 1000,
      url: photo.url,
      thumbUrl: photo.thumbUrl,
    });
    // URLs only: no storage id on the wire.
    expect(JSON.stringify(view)).not.toContain(photo.thumb);
    expect(JSON.stringify(view)).not.toContain(photo.fileId);
  });

  test("before the backfill the photo is served as it was", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { ...SERVABLE, width: 1000 });

    expect(await viewFor(t, s.bob, photo.id)).toEqual({
      status: "ready",
      w: 1000,
      url: await urlOf(t, photo.fileId),
    });
  });

  test("a non-mutual reader gets neither until they tap Show, then both, through the thread", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const sent = await sendThroughPipeline(t, s);
    await settleRenditions(t);
    const { thumbFileId, fileId } = await photoRow(t, sent._id);
    const thumbUrl = await urlOf(t, thumbFileId!);
    const url = await urlOf(t, fileId);
    await stopFollowing(t, s);
    const read = () =>
      asBob(t).query(api.conversation.getThreadMessages.getThreadMessages, {
        threadId: s.threadId,
      });

    const [blurred] = await read();
    expect(blurred.attachment).toMatchObject({
      status: "blurred",
      notMutual: true,
    });
    for (const secret of [url, thumbUrl, fileId, thumbFileId!]) {
      expect(JSON.stringify(blurred)).not.toContain(secret);
    }

    await asBob(t).mutation(
      api.conversation.revealMessageImage.revealMessageImage,
      { attachmentId: sent._id },
    );

    const [shown] = await read();
    expect(shown.attachment).toMatchObject({
      status: "ready",
      revealed: true,
      url,
      thumbUrl,
    });
  });

  test("the sensitive band stays blurred for a reader and is shown to its sender", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s, {
      ...SERVABLE,
      moderationStatus: "blurred",
    });

    const forBob = await viewFor(t, s.bob, photo.id);
    expect(forBob.status).toBe("blurred");
    expectNothingOfIt(forBob, photo);
    expect(await viewFor(t, s.alice, photo.id)).toMatchObject({
      status: "ready",
      thumbUrl: photo.thumbUrl,
    });
  });

  test("a reader with an open report on it gets neither", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await withThumb(t, s);
    await t.run((ctx) =>
      ctx.db.insert("reports", {
        reporterId: s.bob,
        targetKind: "attachment",
        targetId: photo.id,
        reportedUserId: s.alice,
        reason: "other",
        evidence: {},
        status: "open",
        createdAt: 1,
      }),
    );

    const view = await viewFor(t, s.bob, photo.id);
    expect(view.status).toBe("blurred");
    expectNothingOfIt(view, photo);
  });

  test.each<[string, PhotoFields, string]>([
    ["pending", { ...SERVABLE, moderationStatus: "pending" }, "pending"],
    ["unscored", { ...SERVABLE, moderationStatus: "unscored" }, "pending"],
    ["rejected", { ...SERVABLE, moderationStatus: "rejected" }, "removed"],
    [
      "quarantined",
      { ...SERVABLE, moderationStatus: "quarantined" },
      "removed",
    ],
    ["removed", { ...SERVABLE, moderationStatus: "removed" }, "removed"],
    ["not hash-cleared", { ...SERVABLE, hashCheckedAt: undefined }, "pending"],
    ["not re-encoded", { ...SERVABLE, reencodedAt: undefined }, "pending"],
    ["hidden", { ...SERVABLE, hiddenFromSender: true }, "removed"],
  ])(
    "a %s photo gives a reader neither, even with a thumbnail left on its row",
    async (_label, fields, status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const photo = await withThumb(t, s, fields);

      const view = await viewFor(t, s.bob, photo.id);
      expect(view.status).toBe(status);
      expectNothingOfIt(view, photo);
    },
  );

  test.each(["rejected", "quarantined", "removed"] as const)(
    "a %s photo shows its sender no image either",
    async (moderationStatus) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const photo = await withThumb(t, s, { ...SERVABLE, moderationStatus });

      expectNothingOfIt(await viewFor(t, s.alice, photo.id), photo);
    },
  );
});

describe("message photo thumbnails: the backfill", () => {
  // Six rows: an approved and a blurred photo (both get one), a pending and a quarantined one
  // (none), one that already has a thumbnail, and a shared location.
  const seedRows = async (t: T, s: Seeded) => {
    const bytes = await jpeg(800, 600);
    const approved = await seedPhoto(t, s, SERVABLE, bytes);
    const blurred = await seedPhoto(
      t,
      s,
      { ...SERVABLE, moderationStatus: "blurred" },
      bytes,
    );
    const pending = await seedPhoto(
      t,
      s,
      { ...SERVABLE, moderationStatus: "pending" },
      bytes,
    );
    const quarantined = await seedPhoto(
      t,
      s,
      { ...SERVABLE, moderationStatus: "quarantined" },
      bytes,
    );
    const done = await seedPhoto(t, s, {
      ...SERVABLE,
      thumbFileId: await storeWebp(t, "thumbnail"),
    });
    await t.run((ctx) =>
      ctx.db.insert("messageAttachments", {
        kind: "location",
        threadAggregateId: s.threadId,
        uploaderId: s.alice,
        precision: "exact",
        mapStatus: "ready",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    return { approved, blurred, pending, quarantined, done };
  };

  test("is a dry run by default: counts the photos that would get one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedRows(t, s);
    const before = await blobCount(t);

    expect(await t.action(backfill, { table: "message" })).toEqual({
      scanned: 6,
      candidates: 2,
      recorded: 0,
      refused: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await blobCount(t)).toBe(before);
  });

  test("a real run covers servable photos only, continues page by page and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const seeded = await seedRows(t, s);
    vi.useFakeTimers();

    await t.action(backfill, { table: "message", dryRun: false, batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const photo of [seeded.approved, seeded.blurred]) {
      expect((await photoRow(t, photo.id)).thumbFileId).toBeDefined();
    }
    for (const photo of [seeded.pending, seeded.quarantined]) {
      expect((await photoRow(t, photo.id)).thumbFileId).toBeUndefined();
    }
    expect(backfillDoneEvent(logged)).toMatchObject({
      table: "message",
      dry_run: false,
      scanned: 6,
      candidates: 2,
      recorded: 2,
    });

    vi.useRealTimers();
    expect(
      await t.action(backfill, { table: "message", dryRun: false }),
    ).toMatchObject({ candidates: 0, recorded: 0 });
  });
});
