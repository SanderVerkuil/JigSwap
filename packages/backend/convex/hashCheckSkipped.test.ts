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
import { asImage } from "./conversation/messageAttachments";
import { isHashCleared } from "./lib/imageModeration/hashCheckFields";
import schema from "./schema";

// SEC-03 (P-03 Stage 1a): with no CSAM hash matching configured (CSAM_HASHCHECK_PROVIDER unset or
// "none", or "offlimits" with a credential missing), nothing ever records a photo as hash-checked.
// The photo is still published as before (the gate opens), but it is marked "not hash-checked"
// (`hashCheckSkippedAt`) and KEEPS the hashes of the original and the re-encode, so a check can
// run once matching is configured. The hash service is never called. The classifier (Hugging
// Face) and the hash service (Offlimits HCS) are a routed fake `fetch` that records every call.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// convex-test runs a scheduled function through setTimeout with its real delay, and Node fires a
// timeout above 2^31 - 1 ms (~24.8 days) at once. The 30-day purge of a message photo must stay
// pending here, so a timer that long is dropped instead of firing immediately.
const realSetTimeout = globalThis.setTimeout;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

let calls: string[] = [];
let logs: string[] = [];
beforeEach(() => {
  calls = [];
  logs = [];
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
        // A real answer would be no_match; the test fails on any call to it anyway.
        return new Response(JSON.stringify({ match: false }), { status: 200 });
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

  test("offlimits selected with a credential missing: the same, logged at error level, and HCS is never called", async () => {
    stubMissingConfig();
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row, upload } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expectSkipped(row, upload.md5);
    expect(hcsCalls()).toEqual([]);
    const [event] = eventsNamed("library.moderatePhoto");
    expect(event).toMatchObject({
      outcome: "error",
      csam_hashcheck_config: "missing_config",
      csam_hashcheck_status: "skipped",
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
  // while Offlimits was configured): its re-check is armed as attempt 1.
  const heldCopyPhoto = async (t: T) => {
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
        reencodedAt: 1_000,
        hashCheckPendingSince: 1_000,
        pendingHashes: HASHES,
        hashRecheckAttempt: 1,
        hashRecheckDueAt: 1_000,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
    });
  };

  test.each([
    ["provider none", "disabled", () => {}],
    [
      "offlimits with a credential missing",
      "missing_config",
      stubMissingConfig,
    ],
  ])(
    "%s: its re-check publishes it marked not hash-checked, never as checked",
    async (_label, config, stubEnv) => {
      stubEnv();
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
          csam_hashcheck_config: config,
          csam_hashcheck_status: "skipped",
        }),
      ]);
    },
  );
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
