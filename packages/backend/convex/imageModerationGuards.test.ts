import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_IMAGE_UPLOAD_BYTES } from "./lib/imageModeration/guards";
import { findMetadata } from "./lib/imageModeration/stripMetadata";
import schema from "./schema";

// The shared moderation pipeline's input guards, end to end: an upload that is not a supported
// image, is too large, or announces too many pixels is rejected as "invalid_image" before any
// decode or classifier call, and its blob is deleted. Every accepted upload has its metadata
// (EXIF incl. GPS, XMP, IPTC, comments, PNG text chunks, WebP EXIF/XMP) stripped before it is
// stored, served or sent to the classifier; WebP, which jimp cannot decode, keeps its stripped
// bytes.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A clean HF reply; any call to it means the image reached the classifier.
const cleanReply = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify([{ label: "nsfw", score: 0.01 }]), {
        status: 200,
      }),
  );

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { copy, copyAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const settleDueJobs = (t: TestConvex<typeof schema>) => settleDueScheduled(t);

const store = (
  t: TestConvex<typeof schema>,
  bytes: Uint8Array | string,
  type: string,
) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type })),
  ) as Promise<Id<"_storage">>;

const blobExists = (t: TestConvex<typeof schema>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const addCopyPhoto = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
  fileId: Id<"_storage">,
) => {
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId,
    tag: "box_front",
  });
  await settleDueJobs(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return row;
};

// A 6000 x 5000 (30 MP) PNG header: a few dozen bytes that would decode to a 120 MB bitmap.
const PNG_BOMB = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0x17, 0x70, 0, 0, 0x13, 0x88, 8, 6, 0, 0, 0,
]);

// A lossless 2x2 WebP header (VP8L) with an undecodable body: jimp has no WebP decoder anyway.
const WEBP_BYTES = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBPVP8L"),
  0,
  0,
  0,
  0,
  0x2f,
  0x01,
  0x40,
  0x00,
  0x00,
]);

describe("input guards (copy photos)", () => {
  test.each([
    [
      "an SVG",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "image/svg+xml",
      "unsupported_format",
    ],
    [
      "HTML claiming to be a JPEG",
      "<!DOCTYPE html><html></html>",
      "image/jpeg",
      "unsupported_format",
    ],
    ["a decompression bomb", PNG_BOMB, "image/png", "too_many_pixels"],
  ] as const)(
    "%s is rejected as invalid_image, never classified, and its blob deleted",
    async (_name, bytes, type, reason) => {
      const fetchMock = cleanReply();
      vi.stubGlobal("fetch", fetchMock);
      const t = withModerationPool(convexTest(schema, modules));
      const { copy } = await seed(t);
      const fileId = await store(t, bytes, type);

      const row = await addCopyPhoto(t, copy, fileId);

      expect(row.moderationStatus).toBe("rejected");
      expect(row.moderationLabel).toBe("invalid_image");
      expect(row.moderationReason).toBe(reason);
      expect(row.moderationScore).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await blobExists(t, fileId)).toBe(false);
    },
  );

  test("more than 10 MB is refused from the storage metadata", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const big = new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const fileId = await store(t, big, "image/jpeg");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationReason).toBe("too_large");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("an admin can still confirm the removal of a refused upload (its blob is already gone)", async () => {
    vi.stubGlobal("fetch", cleanReply());
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const row = await addCopyPhoto(
      t,
      copy,
      await store(t, "<svg></svg>", "image/svg+xml"),
    );
    expect(row.moderationStatus).toBe("rejected");

    await asAdmin(t).mutation(
      api.admin.confirmPhotoRemoval.confirmPhotoRemoval,
      {
        imageId: row._id,
      },
    );

    expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
  });
});

// Real files with GPS in their metadata (written by ImageMagick, exiv2 and Pillow; see
// stripMetadata.test.ts for what each carries).
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );
const SECRETS = ["Kerkstraat", "Utrecht", "FixtureCam", "52,5.2057N"];
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
const storedBytes = async (
  t: TestConvex<typeof schema>,
  id: Id<"_storage">,
) => {
  const stored = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(id);
    return blob ? { buffer: await blob.arrayBuffer(), type: blob.type } : null;
  });
  return stored && { bytes: new Uint8Array(stored.buffer), type: stored.type };
};
// The bytes each classifier call was sent.
const classifiedBytes = async (fetchMock: ReturnType<typeof cleanReply>) =>
  Promise.all(
    fetchMock.mock.calls.map(async (call) => {
      const init = (call as unknown as [string, RequestInit])[1];
      return new Uint8Array(await (init.body as Blob).arrayBuffer());
    }),
  );

describe("metadata stripped before anything is stored or classified (copy photos)", () => {
  test.each([
    ["a JPEG", "gps.jpg", "image/jpeg", "image/jpeg", "jpeg", [48, 64]],
    [
      "a PNG with transparency",
      "gps.png",
      "image/png",
      "image/png",
      "png",
      [30, 40],
    ],
    // Turned upright needs a decode: re-encoded (opaque, so JPEG) like the others.
    [
      "a sideways WebP",
      "gps.webp",
      "image/webp",
      "image/jpeg",
      "jpeg",
      [30, 40],
    ],
    // Upright already: its stripped bytes are stored as they are.
    [
      "an upright WebP",
      "orientation/1.webp",
      "image/webp",
      "image/webp",
      "webp",
      null,
    ],
  ] as const)(
    "%s with GPS is stored and classified without any metadata; the upload is deleted",
    async (_name, file, uploadType, storedType, format, size) => {
      const fetchMock = cleanReply();
      vi.stubGlobal("fetch", fetchMock);
      const t = withModerationPool(convexTest(schema, modules));
      const { copy } = await seed(t);
      const fileId = await store(t, fixture(file), uploadType);

      const row = await addCopyPhoto(t, copy, fileId);

      expect(row.moderationStatus).toBe("approved");
      expect(row.fileId).not.toBe(fileId);
      expect(row.reencodedAt).toBeGreaterThan(0);
      expect(row.hashCheckedAt).toBeGreaterThan(0);
      expect(await blobExists(t, fileId)).toBe(false);
      const stored = (await storedBytes(t, row.fileId))!;
      expect(stored.type).toBe(storedType);
      expect(findMetadata(stored.bytes, format)).toEqual([]);
      for (const secret of SECRETS) {
        expect(latin1(stored.bytes)).not.toContain(secret);
      }
      // Each fixture's Exif held Orientation 6: the stored pixels are turned upright.
      if (size) {
        const image = await Jimp.read(Buffer.from(stored.bytes));
        expect([image.bitmap.width, image.bitmap.height]).toEqual(size);
      }
      const [sent] = await classifiedBytes(fetchMock);
      expect(sent).toEqual(stored.bytes);
    },
  );

  test("a JPEG whose segments run past the end is refused, never stored or classified", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const jpeg = fixture("gps.jpg");
    // Keep the header (SOF0 with the dimensions) but cut the file before the scan ends.
    const fileId = await store(
      t,
      jpeg.subarray(0, jpeg.length - 40),
      "image/jpeg",
    );

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationReason).toBe("decode_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("when the swap to the clean blob fails, the gate stays closed: no URL for the upload as sent", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, fixture("gps.jpg"), "image/jpeg");
    // Storing the clean blob fails: make every storage write in the pipeline throw.
    const original = Blob.prototype.arrayBuffer;
    let calls = 0;
    vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(function (
      this: Blob,
    ) {
      calls += 1;
      // The first read is the pipeline's download; the next is the store of the clean blob.
      if (calls === 2) return Promise.reject(new Error("storage unavailable"));
      return original.call(this);
    });

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("pending");
    expect(row.fileId).toBe(fileId);
    expect(row.reencodedAt).toBeUndefined();
    expect(row.hashCheckedAt).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(JSON.stringify(view)).not.toContain(
      (await t.run((ctx) => ctx.storage.getUrl(fileId)))!,
    );
  });
});

describe("re-encode on a retry (EXIF/GPS never kept)", () => {
  test("after an attempt-1 download error, attempt 2 re-encodes and swaps before classifying", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const jpeg = new Uint8Array(
      await new Jimp({ width: 8, height: 8, color: 0x336699ff }).getBuffer(
        "image/jpeg",
      ),
    );
    const fileId = await store(t, jpeg, "image/jpeg");
    // The pipeline's download (blob.arrayBuffer) fails once: a retryable download_error.
    vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValueOnce(
      new Error("connection reset"),
    );

    const first = await addCopyPhoto(t, copy, fileId);
    expect(first.moderationStatus).toBe("pending");
    expect(first.fileId).toBe(fileId);
    expect(fetchMock).not.toHaveBeenCalled();

    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId: first._id,
      attempt: 2,
    });

    const after = await t.run((ctx) => ctx.db.get(first._id));
    expect(after?.moderationStatus).toBe("approved");
    expect(after?.fileId).not.toBe(fileId);
    expect(after?.reencodedAt).toBeGreaterThan(0);
    expect(after?.blurhash).toMatch(/^L/);
    expect(await blobExists(t, fileId)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("decode failures and polyglots (copy photos)", () => {
  test("a PNG header over an undecodable body is refused as decode_failed", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    ]);
    const polyglot = new Uint8Array([
      ...png,
      ...new TextEncoder().encode("<html><script>alert(1)</script></html>"),
    ]);
    const fileId = await store(t, polyglot, "text/html");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationLabel).toBe("invalid_image");
    expect(row.moderationReason).toBe("decode_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("WebP claimed as another type is stored again as image/webp and the original deleted", async () => {
    vi.stubGlobal("fetch", cleanReply());
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, WEBP_BYTES, "text/html");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("approved");
    expect(row.fileId).not.toBe(fileId);
    expect(await blobExists(t, fileId)).toBe(false);
    const storedType = await t.run(
      async (ctx) => (await ctx.storage.get(row.fileId))?.type,
    );
    expect(storedType).toBe("image/webp");
  });
});

describe("input guards (completion photos)", () => {
  test("a refused completion photo is rejected and detached from the completion", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const fileId = await store(t, "<html></html>", "image/png");
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId] },
    );
    await settleDueJobs(t);

    const [sidecar] = await t.run((ctx) =>
      ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) => q.eq("completionId", completionId))
        .collect(),
    );
    expect(sidecar.moderationStatus).toBe("rejected");
    expect(sidecar.moderationLabel).toBe("invalid_image");
    expect(sidecar.moderationReason).toBe("unsupported_format");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
    const completion = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(completion?.photos).toEqual([]);
  });
});
