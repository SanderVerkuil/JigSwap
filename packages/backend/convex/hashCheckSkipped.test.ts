import { createHash } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { HASH_CHECK_WAITING_CAP } from "./admin/listCsamEscalations";
import { asImage } from "./conversation/messageAttachments";
import { isHashCleared } from "./lib/imageModeration/hashCheckFields";
import schema from "./schema";

// SEC-03 (P-03 Stage 1a): with no CSAM hash matching configured (CSAM_HASHCHECK_PROVIDER unset or
// "none"), nothing ever records a photo as hash-checked. The photo is still published as before
// (the gate opens), but it is marked "not hash-checked" (`hashCheckSkippedAt`) and KEEPS the
// hashes of the original and the re-encode, so a check can run once matching is configured: the
// one-shot lib/imageModeration/recheckWaivedHashes checks them then. "offlimits" selected with a
// credential missing is an outage, not "off": the photo is held unpublished like when the hash
// service is unreachable (review §4 SEC-03 recommendation 3). The hash service is never called
// while matching is off or incomplete. The classifier (Hugging Face) and the hash service
// (Offlimits HCS) are a routed fake `fetch` that records every call.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// convex-test runs a scheduled function through setTimeout with its real delay, and Node fires a
// timeout above 2^31 - 1 ms (~24.8 days) at once. The 30-day purge of a message photo must stay
// pending here, so a timer that long is dropped instead of firing immediately.
const realSetTimeout = globalThis.setTimeout;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// HCS's verdict once it is configured.
const fakes: { hcs: "match" | "no_match" } = { hcs: "no_match" };

let calls: string[] = [];
let logs: string[] = [];
beforeEach(() => {
  calls = [];
  logs = [];
  fakes.hcs = "no_match";
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: () => void,
    ms?: number,
    ...rest: unknown[]
  ) =>
    (ms ?? 0) > MAX_TIMEOUT_MS
      ? realSetTimeout(() => {}, 0)
      : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
  const capture = (...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", "");
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === HCS_URL) {
        return new Response(JSON.stringify({ match: fakes.hcs === "match" }), {
          status: 200,
        });
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

// Offlimits selected, but its password is missing.
const stubMissingConfig = () => {
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
};

// Offlimits fully configured (the fake `fetch` answers for it).
const configureHashService = () => {
  stubMissingConfig();
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
};

const eventsNamed = (name: string) =>
  logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === name);

const hcsCalls = () => calls.filter((url) => url === HCS_URL);

// Alice and Bob follow each other; Alice owns a copy.
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
    for (const [followerId, followeeId] of [
      [alice, bob],
      [bob, alice],
    ]) {
      await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
    }
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
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
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, copy };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

const md5 = (bytes: Uint8Array) =>
  createHash("md5").update(bytes).digest("hex");

// A real, unique JPEG (so the re-encode runs), stored the way an HTTP upload stores it: with its
// content type on the `_storage` row, which convex-test leaves out.
const storeJpeg = async (t: T) => {
  const image = new Jimp({
    width: 8,
    height: 6,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  const fileId = await t.run(async (ctx) => {
    const id = await ctx.storage.store(
      new Blob([bytes], { type: "image/jpeg" }),
    );
    const db = ctx.db as unknown as {
      patch: (
        id: Id<"_storage">,
        value: { contentType: string },
      ) => Promise<void>;
    };
    await db.patch(id, { contentType: "image/jpeg" });
    return id;
  });
  return { fileId, md5: md5(bytes) };
};

const addCopyPhoto = async (t: T, copy: Id<"ownedPuzzles">) => {
  const upload = await storeJpeg(t);
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId: upload.fileId,
    tag: "box_front",
  });
  await settleDueScheduled(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return { row, upload };
};

// The hash fields of a published, unchecked photo: the gate open, marked not hash-checked, the
// hashes of the original upload and of the stored re-encode kept.
const expectSkipped = (
  row: Pick<
    Doc<"ownedPuzzleImages">,
    | "hashCheckedAt"
    | "hashCheckSkippedAt"
    | "hashCheckPendingSince"
    | "pendingHashes"
  > & { moderationStatus?: string },
  originalMd5: string,
) => {
  expect(row.hashCheckedAt).toEqual(expect.any(Number));
  expect(row.hashCheckSkippedAt).toEqual(expect.any(Number));
  expect(row.hashCheckPendingSince).toBeUndefined();
  expect(row.pendingHashes).toHaveLength(2);
  expect(row.pendingHashes![0].md5).toBe(originalMd5);
  expect(row.pendingHashes![1].md5).not.toBe(originalMd5);
  expect(isHashCleared(row)).toBe(true);
};

describe("an upload while hash matching is not configured", () => {
  test("provider none: a copy photo is published, marked not hash-checked, its hashes kept; the hash service is never asked", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row, upload } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expectSkipped(row, upload.md5);
    expect(hcsCalls()).toEqual([]);
    const [event] = eventsNamed("library.moderatePhoto");
    expect(event).toMatchObject({
      outcome: "success",
      csam_hashcheck_config: "disabled",
      csam_hashcheck_status: "skipped",
      decision: "approved",
    });
  });

  test("offlimits selected with a credential missing: held unpublished like an outage, its hashes kept for a re-check, logged at error level, and HCS is never called", async () => {
    stubMissingConfig();
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row, upload } = await addCopyPhoto(t, copy);

    // Screened as usual, but its gate stays closed: nothing marks it published unchecked.
    expect(row.moderationStatus).toBe("approved");
    expect(row.hashCheckedAt).toBeUndefined();
    expect(row.hashCheckSkippedAt).toBeUndefined();
    expect(row.hashCheckPendingSince).toEqual(expect.any(Number));
    expect(row.pendingHashes).toHaveLength(2);
    expect(row.pendingHashes![0].md5).toBe(upload.md5);
    expect(row.hashRecheckAttempt).toBe(1);
    expect(isHashCleared(row)).toBe(false);
    expect(hcsCalls()).toEqual([]);
    const [event] = eventsNamed("library.moderatePhoto");
    expect(event).toMatchObject({
      outcome: "error",
      csam_hashcheck_config: "missing_config",
      csam_hashcheck_status: "unavailable",
      csam_hashcheck_reason: "missing_config",
    });
  });

  test("provider none: a message photo is delivered, marked not hash-checked, its hashes kept", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { bob } = await seed(t);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    const upload = await storeJpeg(t);
    const staged = await asAlice(t).mutation(
      api.conversation.stageMessageImage.stageMessageImage,
      { threadId, storageId: upload.fileId, width: 800, height: 600 },
    );
    if (!("attachmentId" in staged)) {
      throw new Error(`staging refused: ${staged.refused}`);
    }
    await settleDueScheduled(t);
    await asAlice(t).mutation(
      api.conversation.sendStagedImages.sendStagedImages,
      { threadId, attachmentIds: [staged.attachmentId] },
    );
    await settleDueScheduled(t);

    const row = await t.run(async (ctx) =>
      asImage(await ctx.db.get(staged.attachmentId)),
    );
    expect(row!.moderationStatus).toBe("approved");
    expectSkipped(row!, upload.md5);
    const [message] = await asBob(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(message.attachment).toMatchObject({ status: "ready" });
    expect(hcsCalls()).toEqual([]);
  });
});

describe("a photo held for its hash check when matching is switched off", () => {
  const HASHES = [
    { md5: "a".repeat(32), sha1: "b".repeat(40) },
    { md5: "c".repeat(32), sha1: "d".repeat(40) },
  ];

  // A copy photo the classifier approved, held because its hash check was unavailable (it ran
  // while Offlimits was configured) since `pendingSince`: its re-check is armed as attempt 1.
  const heldCopyPhoto = async (t: T, pendingSince = 1_000) => {
    const { alice, copy } = await seed(t);
    return t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
      );
      return ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: alice,
        fileId,
        moderationStatus: "approved",
        moderationScore: 0.01,
        reencodedAt: pendingSince,
        hashCheckPendingSince: pendingSince,
        pendingHashes: HASHES,
        hashRecheckAttempt: 1,
        hashRecheckDueAt: pendingSince,
        createdAt: pendingSince,
        updatedAt: pendingSince,
      });
    });
  };

  test("provider none: its re-check publishes it marked not hash-checked, never as checked", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await heldCopyPhoto(t);

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId,
      attempt: 1,
      pooled: true,
    });

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row!.hashCheckedAt).toEqual(expect.any(Number));
    expect(row!.hashCheckSkippedAt).toEqual(expect.any(Number));
    expect(row!.hashCheckPendingSince).toBeUndefined();
    expect(row!.pendingHashes).toEqual(HASHES);
    expect(hcsCalls()).toEqual([]);
    expect(eventsNamed("library.moderatePhoto.hashRecheck")).toEqual([
      expect.objectContaining({
        csam_hashcheck_config: "disabled",
        csam_hashcheck_status: "skipped",
      }),
    ]);
  });

  test("offlimits with a credential missing: its re-check keeps it held and arms the next one, never publishing it", async () => {
    stubMissingConfig();
    const t = withModerationPool(convexTest(schema, modules));
    // Held a minute ago, well inside the 7-day timeout.
    const pendingSince = Date.now() - 60_000;
    const imageId = await heldCopyPhoto(t, pendingSince);

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId,
      attempt: 1,
      pooled: true,
    });

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row!.hashCheckedAt).toBeUndefined();
    expect(row!.hashCheckSkippedAt).toBeUndefined();
    expect(row!.hashCheckTimedOutAt).toBeUndefined();
    expect(row!.hashCheckPendingSince).toBe(pendingSince);
    expect(row!.pendingHashes).toEqual(HASHES);
    expect(row!.hashRecheckAttempt).toBe(2);
    expect(isHashCleared(row!)).toBe(false);
    expect(hcsCalls()).toEqual([]);
    expect(eventsNamed("library.moderatePhoto.hashRecheck")).toEqual([
      expect.objectContaining({
        outcome: "error",
        csam_hashcheck_config: "missing_config",
        csam_hashcheck_status: "unavailable",
        csam_hashcheck_reason: "missing_config",
      }),
    ]);
  });
});

describe("recording the skip", () => {
  const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];

  const insertRow = (
    t: T,
    s: { alice: Id<"users">; copy: Id<"ownedPuzzles"> },
    fields: Partial<Doc<"ownedPuzzleImages">>,
  ) =>
    t.run(async (ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: s.copy,
        uploaderId: s.alice,
        fileId: await ctx.storage.store(new Blob(["x"])),
        moderationStatus: "pending",
        hashCheckPendingSince: 1_000,
        createdAt: 1_000,
        updatedAt: 1_000,
        ...fields,
      }),
    );

  test("skipped opens the gate and keeps the hashes; a later no_match records a real check", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const imageId = await insertRow(t, s, {});

    await t.mutation(internal.library.moderationStore.setHashCheck, {
      imageId,
      status: "skipped",
      hashes: HASHES,
    });
    const skipped = await t.run((ctx) => ctx.db.get(imageId));
    expect(skipped).toMatchObject({
      hashCheckedAt: expect.any(Number),
      hashCheckSkippedAt: expect.any(Number),
      pendingHashes: HASHES,
    });
    expect(skipped!.hashCheckPendingSince).toBeUndefined();

    await t.mutation(internal.library.moderationStore.setHashCheck, {
      imageId,
      status: "no_match",
    });
    const checked = await t.run((ctx) => ctx.db.get(imageId));
    expect(checked!.hashCheckedAt).toEqual(expect.any(Number));
    expect(checked!.hashCheckSkippedAt).toBeUndefined();
    expect(checked!.pendingHashes).toBeUndefined();
  });

  test("skipped never touches a quarantined row, nor one whose gate already opened", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const quarantined = await insertRow(t, s, {
      moderationStatus: "quarantined",
    });
    const checked = await insertRow(t, s, {
      moderationStatus: "approved",
      hashCheckedAt: 2_000,
      hashCheckPendingSince: undefined,
    });

    for (const imageId of [quarantined, checked]) {
      await t.mutation(internal.library.moderationStore.setHashCheck, {
        imageId,
        status: "skipped",
        hashes: HASHES,
      });
    }

    const [q, c] = await t.run((ctx) =>
      Promise.all([ctx.db.get(quarantined), ctx.db.get(checked)]),
    );
    expect(q!.hashCheckSkippedAt).toBeUndefined();
    expect(q!.hashCheckedAt).toBeUndefined();
    expect(c!.hashCheckSkippedAt).toBeUndefined();
    expect(c!.hashCheckedAt).toBe(2_000);
    expect(c!.pendingHashes).toBeUndefined();
  });
});

describe("once hash matching is configured, the one-shot checks the photos published unchecked", () => {
  const recheck = (t: T, dryRun: boolean) =>
    t.mutation(
      internal.lib.imageModeration.recheckWaivedHashes.recheckWaivedHashes,
      { dryRun },
    );

  test("no_match records a real check: the marker and the stored hashes go", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    expect(row.hashCheckSkippedAt).toEqual(expect.any(Number));

    configureHashService();
    expect(await recheck(t, true)).toMatchObject({ waived: 1, enqueued: 0 });
    expect(hcsCalls()).toEqual([]);
    expect(await recheck(t, false)).toMatchObject({ waived: 1, enqueued: 1 });
    await settleDueScheduled(t);

    const after = await t.run((ctx) => ctx.db.get(row._id));
    // The original and the re-encode were both checked.
    expect(hcsCalls()).toHaveLength(2);
    expect(after!.moderationStatus).toBe("approved");
    expect(after!.hashCheckedAt).toEqual(expect.any(Number));
    expect(after!.hashCheckSkippedAt).toBeUndefined();
    expect(after!.pendingHashes).toBeUndefined();
    expect(await recheck(t, true)).toMatchObject({ waived: 0 });
  });

  test("a match quarantines it, raises the escalation and closes the gate", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row, upload } = await addCopyPhoto(t, copy);

    configureHashService();
    fakes.hcs = "match";
    await recheck(t, false);
    await settleDueScheduled(t);

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after!.moderationStatus).toBe("quarantined");
    expect(isHashCleared(after!)).toBe(false);
    const [escalation] = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    // The first pair checked is the original upload's.
    expect(escalation).toMatchObject({
      rowId: row._id,
      md5: upload.md5,
      originalDiscarded: true,
    });
    expect(await recheck(t, true)).toMatchObject({ waived: 0 });
  });

  test.each([
    ["provider none", () => {}],
    ["offlimits with a credential missing", stubMissingConfig],
  ])(
    "%s: a re-check of a photo published unchecked asks nothing and changes nothing",
    async (_label, stubEnv) => {
      const t = withModerationPool(convexTest(schema, modules));
      const { copy } = await seed(t);
      const { row } = await addCopyPhoto(t, copy);
      stubEnv();

      await t.action(internal.library.moderatePhoto.recheckHashes, {
        imageId: row._id,
        attempt: 1,
        pooled: true,
      });

      expect(hcsCalls()).toEqual([]);
      expect(await t.run((ctx) => ctx.db.get(row._id))).toEqual(row);
      expect(
        eventsNamed("library.moderatePhoto.hashRecheck").map((e) => e.result),
      ).toEqual(["skipped_unconfigured"]);
    },
  );
});

describe("the admin count of photos published without a hash check", () => {
  test("counts every table's unchecked photos, but not a quarantined one, with the oldest", async () => {
    const t = convexTest(schema, modules);
    const { alice, copy } = await seed(t);
    const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];
    await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["x"]));
      const copyPhoto = (skippedAt: number, quarantined = false) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId: alice,
          fileId,
          moderationStatus: quarantined ? "quarantined" : "approved",
          hashCheckedAt: skippedAt,
          hashCheckSkippedAt: skippedAt,
          pendingHashes: quarantined ? undefined : HASHES,
          createdAt: skippedAt,
          updatedAt: skippedAt,
        });
      await copyPhoto(1_000, true);
      await copyPhoto(3_000);
      await copyPhoto(4_000);
      await ctx.db.insert("boxArtUploads", {
        storageId: fileId,
        uploaderId: alice,
        moderationStatus: "approved",
        hashCheckedAt: 2_000,
        hashCheckSkippedAt: 2_000,
        pendingHashes: HASHES,
        createdAt: 2_000,
      });
      // Really checked: not counted.
      await ctx.db.insert("boxArtUploads", {
        storageId: fileId,
        uploaderId: alice,
        moderationStatus: "approved",
        hashCheckedAt: 500,
        createdAt: 500,
      });
    });

    const { hashCheck } = await t
      .withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } })
      .query(api.admin.listCsamEscalations.listCsamEscalations, {});

    expect(hashCheck).toMatchObject({
      uncheckedPhotos: 3,
      uncheckedSince: 2_000,
      uncheckedCapped: false,
    });
  });

  test("says when a table's count hit the cap", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      for (let i = 0; i < HASH_CHECK_WAITING_CAP + 1; i++) {
        await ctx.db.insert("boxArtUploads", {
          storageId,
          uploaderId: alice,
          moderationStatus: "approved",
          hashCheckedAt: 1_000 + i,
          hashCheckSkippedAt: 1_000 + i,
          createdAt: 1_000,
        });
      }
    });

    const { hashCheck } = await t
      .withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } })
      .query(api.admin.listCsamEscalations.listCsamEscalations, {});

    expect(hashCheck).toMatchObject({
      uncheckedPhotos: HASH_CHECK_WAITING_CAP,
      uncheckedSince: 1_000,
      uncheckedCapped: true,
    });
  });
});
