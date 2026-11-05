import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { asImage } from "./conversation/messageAttachments";
import { isHashCleared } from "./lib/imageModeration/hashCheckFields";
import schema from "./schema";

// SEC-04: the report screens never serve, and never copy, the bytes of a CSAM-quarantined photo
// (lib/imageModeration/quarantine: never shown to anyone, admins included), nor the bytes of a
// photo whose CSAM hash check has not passed. Covers admin/getReport (the photo, the message
// photo, its evidence copy), reports/fileReport (which photos can be reported at all),
// admin/decideReport and reports/attachmentEvidence (a removal never rewrites or copies a
// quarantined photo). The shared pipeline runs for real; the classifier (Hugging Face) and the
// CSAM hash service (Offlimits HCS) are a routed fake `fetch`.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// HCS's verdict, or an HTTP status (503: the hash service is down, so the check stays pending).
const fakes: { hcs: "no_match" | number } = { hcs: "no_match" };

// convex-test runs a scheduled function through setTimeout with its real delay, and Node fires a
// timeout above 2^31 - 1 ms (~24.8 days) at once. The 30-day purge and the report/evidence
// retention must stay pending here, so a timer that long is dropped instead of firing immediately.
const realSetTimeout = globalThis.setTimeout;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

beforeEach(() => {
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: () => void,
    ms?: number,
    ...rest: unknown[]
  ) =>
    (ms ?? 0) > MAX_TIMEOUT_MS
      ? realSetTimeout(() => {}, 0)
      : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
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
          : new Response(JSON.stringify({ match: false }), { status: 200 });
      }
      if (url.includes(HF_HOST)) {
        return new Response(
          JSON.stringify([
            { label: "nsfw", score: 0.01 },
            { label: "normal", score: 0.99 },
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

// Alice uploads, Bob (her mutual follower) reports, Ada is the admin. Alice's copy is open for
// trade, so Bob can see it and its photos.
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
    const ada = await mkUser("clerk_ada");
    for (const [followerId, followeeId] of [
      [alice, bob],
      [bob, alice],
    ]) {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    }
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      snapshot: { title: "Starry Night", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, ada, copy };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

type CopyPhotoState = {
  moderationStatus?: "pending" | "approved" | "rejected" | "unscored";
  hashCheckedAt?: number;
  hashCheckPendingSince?: number;
};

// A copy photo of Alice's in the given moderation and hash-check state (absent = legacy).
const insertCopyPhoto = (
  t: T,
  { alice, copy }: { alice: Id<"users">; copy: Id<"ownedPuzzles"> },
  state: CopyPhotoState,
) =>
  t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob(["copy-photo"]));
    return ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId,
      ...state,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

// The blob the pipeline stores for a CSAM match (preserveAndQuarantine): never served.
const storePreserved = (t: T) =>
  t.run((ctx) => ctx.storage.store(new Blob(["CSAM-PRESERVED-BYTES"])));

const urlOf = (t: T, id: Id<"_storage">) =>
  t.run((ctx) => ctx.storage.getUrl(id));

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const blobCount = (t: T) =>
  t.run(
    async (ctx) => (await ctx.db.system.query("_storage").collect()).length,
  );

const photoUrlOf = async (t: T, reportId: Id<"reports">) =>
  (await asAdmin(t).query(api.admin.getReport.getReport, { reportId }))
    .photoUrl;

const reportRow = (t: T, id: Id<"reports">) =>
  t.run(async (ctx) => (await ctx.db.get(id))!);

const attachment = (t: T, id: Id<"messageAttachments">) =>
  t.run(async (ctx) => asImage(await ctx.db.get(id))!);

const decide = (
  t: T,
  reportId: Id<"reports">,
  decision: "dismissed" | "content_removed" | "warned",
) =>
  asAdmin(t).mutation(api.admin.decideReport.decideReport, {
    reportId,
    decision,
    statementOfReasons: "The caption breaks the rules",
  });

// convex-test does not record an upload's content type on its `_storage` row (the real upload
// endpoint does); set it the way an HTTP upload would, so staging accepts the JPEG.
type StorageRowWriter = {
  patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void>;
};

// Alice sends Bob a real (unique) JPEG with a caption in their DM. The pipeline runs for real: with
// HCS answering 503 the photo is approved and re-encoded but its hash check stays pending, so it
// is appended (append at send) yet never servable.
const sendPhoto = async (t: T) => {
  const people = await seed(t);
  const threadId = await asAlice(t).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: people.bob },
  );
  const image = new Jimp({
    width: 8,
    height: 6,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  const storageId = await t.run(async (ctx) => {
    const id = await ctx.storage.store(
      new Blob([bytes], { type: "image/jpeg" }),
    );
    await (ctx.db as unknown as StorageRowWriter).patch(id, {
      contentType: "image/jpeg",
    });
    return id;
  });
  const staged = await asAlice(t).mutation(
    api.conversation.stageMessageImage.stageMessageImage,
    { threadId, storageId, width: 8, height: 6 },
  );
  if (!("attachmentId" in staged)) {
    throw new Error(`staging refused: ${staged.refused}`);
  }
  const id = staged.attachmentId;
  await settleDueScheduled(t);
  await asAlice(t).mutation(
    api.conversation.sendStagedImages.sendStagedImages,
    { threadId, attachmentIds: [id], caption: "look at this" },
  );
  await settleDueScheduled(t);
  const messageId = (await attachment(t, id)).messageId!;
  return { ...people, threadId, id, messageId };
};

const store = internal.conversation.attachmentModerationStore;

describe("getReport: a reported copy photo", () => {
  test("quarantined after the report was filed: no URL, the preserved blob above all", async () => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "photo", targetId: photoId, reason: "sexual" },
    );
    expect(await photoUrlOf(t, reportId)).toEqual(expect.any(String));

    const preserved = await storePreserved(t);
    await t.mutation(internal.library.moderationStore.quarantineImage, {
      imageId: photoId,
      fileId: preserved,
      uploaderId: people.alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    expect(await photoUrlOf(t, reportId)).toBeNull();
  });

  test("a blob a CSAM escalation preserves is never served, whatever the row's status says", async () => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "photo", targetId: photoId, reason: "sexual" },
    );
    // The row still reads approved, but its blob is an escalation's preserved one.
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(photoId))!;
      await ctx.db.insert("csamEscalations", {
        table: "ownedPuzzleImages",
        rowId: photoId,
        uploaderId: people.alice,
        fileId: row.fileId,
        md5: "m",
        sha1: "s",
        provider: "offlimits",
        matchedAt: Date.now(),
        status: "open",
      });
    });
    expect(await photoUrlOf(t, reportId)).toBeNull();
  });

  test("a photo whose hash check has not passed (any more) is not served", async () => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "photo", targetId: photoId, reason: "sexual" },
    );
    await t.run((ctx) =>
      ctx.db.patch(photoId, {
        hashCheckedAt: undefined,
        hashCheckPendingSince: 1,
      }),
    );
    expect(await photoUrlOf(t, reportId)).toBeNull();
  });
});

describe("getReport: a removed message photo's evidence copy", () => {
  test("is hidden while the photo's hash check is pending, and shown once it passes", async () => {
    fakes.hcs = 503;
    const t = withModerationPool(convexTest(schema, modules));
    const { id, messageId } = await sendPhoto(t);
    const before = await attachment(t, id);
    expect(before.moderationStatus).toBe("approved");
    expect(before.hashCheckedAt).toBeUndefined();
    expect(before.pendingHashes).toHaveLength(2);

    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "message", targetId: messageId, reason: "harassment_hate" },
    );
    expect(await photoUrlOf(t, reportId)).toBeNull();
    await decide(t, reportId, "content_removed");
    await settleDueScheduled(t);
    expect((await reportRow(t, reportId)).evidenceFileId).toBeDefined();
    // The copy holds bytes nobody has hash-checked: hidden like the photo itself.
    expect(await photoUrlOf(t, reportId)).toBeNull();

    await t.mutation(store.setHashCheck, { imageId: id, status: "no_match" });
    expect(await photoUrlOf(t, reportId)).toEqual(expect.any(String));
  });

  test("copied before a later CSAM match: hidden from then on", async () => {
    fakes.hcs = 503;
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, ada, id } = await sendPhoto(t);
    // An admin released it after its hash check timed out (decideUncheckedPhoto): served, but its
    // hashes are kept, so a later re-check can still match it.
    await t.run((ctx) =>
      ctx.db.patch(id, { hashCheckedAt: Date.now(), hashCheckWaivedBy: ada }),
    );
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "attachment", targetId: id, reason: "sexual" },
    );
    await decide(t, reportId, "content_removed");
    await settleDueScheduled(t);
    const evidenceFileId = (await reportRow(t, reportId)).evidenceFileId!;
    expect(await photoUrlOf(t, reportId)).toBe(await urlOf(t, evidenceFileId));

    // The re-check matches after the served blob is gone: escalated on the hashes alone.
    await t.mutation(store.quarantineImage, {
      imageId: id,
      uploaderId: alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    expect((await attachment(t, id)).moderationStatus).toBe("quarantined");
    expect(await photoUrlOf(t, reportId)).toBeNull();
  });
});

describe("fileReport: a copy photo is reportable only as others saw it", () => {
  test.each<[string, CopyPhotoState]>([
    ["pending", { moderationStatus: "pending", hashCheckedAt: 1 }],
    ["rejected", { moderationStatus: "rejected", hashCheckedAt: 1 }],
    ["unscored", { moderationStatus: "unscored", hashCheckedAt: 1 }],
    [
      "approved, hash check pending",
      { moderationStatus: "approved", hashCheckPendingSince: 1 },
    ],
  ])("%s: NotFound", async (_label, state) => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, state);
    await expect(
      asBob(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "photo",
        targetId: photoId,
        reason: "sexual",
      }),
    ).rejects.toThrow(/NotFound/);
  });

  test("quarantined: NotFound", async () => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    await t.mutation(internal.library.moderationStore.quarantineImage, {
      imageId: photoId,
      fileId: await storePreserved(t),
      uploaderId: people.alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    await expect(
      asBob(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "photo",
        targetId: photoId,
        reason: "sexual",
      }),
    ).rejects.toThrow(/NotFound/);
  });

  test.each<[string, CopyPhotoState]>([
    [
      "approved and hash-checked",
      { moderationStatus: "approved", hashCheckedAt: 1 },
    ],
    ["legacy (no status, no hash fields)", {}],
  ])("%s: filed", async (_label, state) => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, state);
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "photo", targetId: photoId, reason: "sexual" },
    );
    expect((await reportRow(t, reportId)).targetId).toBe(photoId);
  });
});

describe("decideReport: removing content never rewrites or copies a quarantined photo", () => {
  test("an image message reported while its hash check was pending, then matched: stays quarantined, no evidence copy", async () => {
    fakes.hcs = 503;
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, id, messageId, threadId } = await sendPhoto(t);
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "message", targetId: messageId, reason: "harassment_hate" },
    );
    expect((await attachment(t, id)).evidenceHold).toBe(true);

    // The re-check matches: the pipeline preserves the bytes as a new blob and quarantines.
    const preserved = await storePreserved(t);
    await t.mutation(store.quarantineImage, {
      imageId: id,
      fileId: preserved,
      uploaderId: alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    expect(await photoUrlOf(t, reportId)).toBeNull();

    // The admin, who sees no photo, removes the message for its caption.
    const blobsBefore = await blobCount(t);
    await decide(t, reportId, "content_removed");
    await settleDueScheduled(t);

    const row = await attachment(t, id);
    expect(row.moderationStatus).toBe("quarantined");
    expect(row.fileId).toBe(preserved);
    expect(row.evidenceHold).toBeUndefined();
    expect(await blobExists(t, preserved)).toBe(true);
    expect(await blobCount(t)).toBe(blobsBefore);
    const report = await reportRow(t, reportId);
    expect(report.evidenceFileId).toBeUndefined();
    expect(report.evidencePendingSince).toBeUndefined();
    expect(await photoUrlOf(t, reportId)).toBeNull();
    // The message itself is still removed: its caption is gone for both participants.
    const messages = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
        .collect(),
    );
    expect(messages.find((m) => m.messageId === messageId)).toMatchObject({
      body: "",
      removedAt: expect.any(Number),
    });
  });

  test("a photo quarantined after the decision, before its evidence is copied: nothing is copied", async () => {
    fakes.hcs = 503;
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, id, messageId } = await sendPhoto(t);
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "message", targetId: messageId, reason: "harassment_hate" },
    );
    const preserved = await storePreserved(t);
    await t.mutation(store.quarantineImage, {
      imageId: id,
      fileId: preserved,
      uploaderId: alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    // The evidence job that the decision scheduled runs only now.
    await t.run((ctx) =>
      ctx.db.patch(reportId, { evidencePendingSince: Date.now() }),
    );
    const blobsBefore = await blobCount(t);
    await t.action(internal.reports.attachmentEvidence.preserveEvidence, {
      reportId,
      attachmentId: id,
    });
    expect(await blobCount(t)).toBe(blobsBefore);
    const report = await reportRow(t, reportId);
    expect(report.evidenceFileId).toBeUndefined();
    expect(report.evidencePendingSince).toBeUndefined();
    const row = await attachment(t, id);
    expect(row.moderationStatus).toBe("quarantined");
    expect(row.evidenceHold).toBeUndefined();
    expect(await blobExists(t, preserved)).toBe(true);
  });

  test("a reported copy photo quarantined before the decision is kept whole", async () => {
    const t = convexTest(schema, modules);
    const people = await seed(t);
    const photoId = await insertCopyPhoto(t, people, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "photo", targetId: photoId, reason: "sexual" },
    );
    const preserved = await storePreserved(t);
    await t.mutation(internal.library.moderationStore.quarantineImage, {
      imageId: photoId,
      fileId: preserved,
      uploaderId: people.alice,
      md5: "m",
      sha1: "s",
      provider: "offlimits",
      originalDiscarded: true,
    });
    await decide(t, reportId, "content_removed");
    const row = await t.run((ctx) => ctx.db.get(photoId));
    expect(row).toMatchObject({
      moderationStatus: "quarantined",
      fileId: preserved,
    });
    expect(await blobExists(t, preserved)).toBe(true);
    expect((await reportRow(t, reportId)).decision).toBe("content_removed");
  });
});

describe("the hash gate (isHashCleared)", () => {
  test("is closed for a quarantined row, even one whose gate had opened before the match", () => {
    // An admin-waived photo (or one approved before a later re-check) keeps hashCheckedAt when a
    // re-check quarantines it; the gate must still close, since its fileId is now preserved.
    expect(
      isHashCleared({ moderationStatus: "quarantined", hashCheckedAt: 1 }),
    ).toBe(false);
    expect(isHashCleared({ moderationStatus: "quarantined" })).toBe(false);
  });

  test("is unchanged otherwise: open once checked, open for legacy rows, closed while pending", () => {
    expect(
      isHashCleared({ moderationStatus: "approved", hashCheckedAt: 1 }),
    ).toBe(true);
    expect(isHashCleared({})).toBe(true);
    expect(isHashCleared({ hashCheckPendingSince: 1 })).toBe(false);
    expect(isHashCleared({ hashCheckPendingSince: 1, hashCheckedAt: 2 })).toBe(
      true,
    );
  });
});
