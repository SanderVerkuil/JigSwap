import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  craftPng,
  iendChunk,
  ihdrChunk,
  pngChunk,
  transparentIdat,
  transparentPng,
} from "../test-fixtures/craftPng";
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
// image, is too large, announces too many pixels, has a header a decoder could read
// differently (a PNG with a second IHDR, or interlaced), or is an animation (an animated WebP, an
// APNG) is rejected as "invalid_image" before any decode or classifier call, and its blob is
// deleted. Every accepted upload has its metadata
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

// The review's dual-IHDR PNG (SEC-17): the first IHDR says 1x1, the second 5200x5000 (26 MP), over
// a deflated body of that size (about 100 KB). pngjs takes the last IHDR's size.
const DUAL_IHDR_PNG = craftPng(
  ihdrChunk(1, 1),
  ihdrChunk(5200, 5000),
  transparentIdat(5200, 5000),
  iendChunk(),
);

// SOI, a baseline frame header (SOF0) of the given size with one component per sampling byte
// (horizontal << 4 | vertical), and EOI.
const jpegFrame = (width: number, height: number, sampling: number[]) => {
  const length = 8 + 3 * sampling.length;
  return new Uint8Array([
    ...[0xff, 0xd8, 0xff, 0xc0, length >> 8, length & 0xff, 8],
    ...[height >> 8, height & 0xff, width >> 8, width & 0xff, sampling.length],
    ...sampling.flatMap((hv, c) => [c + 1, hv, 0]),
    ...[0xff, 0xd9],
  ]);
};

// The review's 25 MP JPEG (SEC-18): a 5000 x 5000 frame, OOM-killed on every attempt.
const JPEG_25MP = jpegFrame(5000, 5000, [0x22, 0x11, 0x11]);

// 779 bytes and 1 x 65535 pixels, but 255 components sampled 15x15: jpeg-js allocates over
// 1 GiB of blocks for it before it gives up (SEC-18).
const JPEG_BLOCK_BOMB = jpegFrame(1, 65535, new Array<number>(255).fill(0xff));

const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
// `n` as `bytes` little-endian bytes.
const le = (n: number, bytes: number) =>
  Array.from({ length: bytes }, (_, k) => (n >>> (8 * k)) & 0xff);
// A RIFF chunk: FourCC, size, payload, padded to an even length.
const riffChunk = (type: string, payload: number[]) => [
  ...ascii(type),
  ...le(payload.length, 4),
  ...payload,
  ...(payload.length % 2 ? [0] : []),
];
// The chunks of a WebP after "RIFF....WEBP", by FourCC, each with its header and padding.
const webpChunks = (webp: Uint8Array) => {
  const chunks = new Map<string, number[]>();
  for (let i = 12; i + 8 <= webp.length;) {
    const size =
      (webp[i + 4] | (webp[i + 5] << 8) | (webp[i + 6] << 16)) +
      webp[i + 7] * 2 ** 24;
    const end = i + 8 + size + (size % 2);
    chunks.set(
      String.fromCharCode(...webp.subarray(i, i + 4)),
      Array.from(webp.subarray(i, end)),
    );
    i = end;
  }
  return chunks;
};

// The review's animated WebP (SEC-72, SEC-76): a VP8X canvas flagged as an animation, and one
// frame (ANMF) that carries, after its bitstream, the EXIF (with a GPS position) and XMP chunks
// of gps.webp. The byte-level stripper keeps an ANMF chunk as it is, without looking inside.
const ANIMATED_GPS_WEBP = (() => {
  const gps = webpChunks(
    new Uint8Array(
      readFileSync(
        new URL("../test-fixtures/images/gps.webp", import.meta.url),
      ),
    ),
  );
  const canvas = [...le(40 - 1, 3), ...le(30 - 1, 3)];
  const body = [
    ...riffChunk("VP8X", [0x02, 0, 0, 0, ...canvas]),
    ...riffChunk("ANIM", [0, 0, 0, 0, 0, 0]),
    ...riffChunk("ANMF", [
      ...le(0, 3),
      ...le(0, 3),
      ...canvas,
      ...le(100, 3),
      0,
      ...gps.get("VP8 ")!,
      ...gps.get("EXIF")!,
      ...gps.get("XMP ")!,
    ]),
  ];
  return new Uint8Array([
    ...ascii("RIFF"),
    ...le(4 + body.length, 4),
    ...ascii("WEBP"),
    ...body,
  ]);
})();

// An APNG: a still PNG plus an animation control chunk (acTL).
const APNG = craftPng(
  ihdrChunk(2, 2),
  pngChunk("acTL", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0])),
  transparentIdat(2, 2),
  iendChunk(),
);

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
    [
      "a PNG whose second IHDR lies about its size",
      DUAL_IHDR_PNG,
      "image/png",
      "unreadable_header",
    ],
    [
      "an interlaced PNG",
      transparentPng(5, 5, { interlaced: true }),
      "image/png",
      "interlaced",
    ],
    ["the review's 25 MP JPEG", JPEG_25MP, "image/jpeg", "too_many_pixels"],
    [
      "a 779-byte JPEG whose frame header makes jpeg-js allocate over 1 GiB",
      JPEG_BLOCK_BOMB,
      "image/jpeg",
      "unreadable_header",
    ],
    ["an animated WebP", ANIMATED_GPS_WEBP, "image/webp", "animated"],
    ["an APNG", APNG, "image/png", "animated"],
  ] as const)(
    "%s is rejected as invalid_image, never decoded or classified, and its blob deleted",
    async (_name, bytes, type, reason) => {
      const fetchMock = cleanReply();
      vi.stubGlobal("fetch", fetchMock);
      const decode = vi.spyOn(Jimp, "fromBuffer");
      const t = withModerationPool(convexTest(schema, modules));
      const { copy } = await seed(t);
      const fileId = await store(t, bytes, type);

      const row = await addCopyPhoto(t, copy, fileId);

      expect(row.moderationStatus).toBe("rejected");
      expect(row.moderationLabel).toBe("invalid_image");
      expect(row.moderationReason).toBe(reason);
      expect(row.moderationScore).toBeUndefined();
      expect(decode).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await blobExists(t, fileId)).toBe(false);
    },
  );

  test("an animated WebP with EXIF and GPS inside a frame never reaches storage or the classifier", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, ANIMATED_GPS_WEBP, "image/webp");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationReason).toBe("animated");
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(stored).toEqual([]);
  });

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

  test("a decoder that reads another size than the header is refused as decode_failed", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, transparentPng(3, 2), "image/png");
    // Whatever the guards checked on the header, the decoder comes back with 64x64.
    const bigger = await Jimp.fromBuffer(Buffer.from(transparentPng(64, 64)));
    vi.spyOn(Jimp, "fromBuffer").mockResolvedValue(bigger);

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationLabel).toBe("invalid_image");
    expect(row.moderationReason).toBe("decode_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("a JPEG that hits jpeg-js's own allocation cap is refused as decode_failed, not retried", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, fixture("gps.jpg"), "image/jpeg");
    // What jpeg-js throws instead of allocating past maxMemoryUsageInMB.
    vi.spyOn(Jimp, "fromBuffer").mockRejectedValue(
      new Error("maxMemoryUsageInMB limit exceeded by at least 13MB"),
    );

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationLabel).toBe("invalid_image");
    expect(row.moderationReason).toBe("decode_failed");
    expect(row.moderationAttempts).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("a re-encode over 10 MB is refused as too_large, never stored or classified", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = await store(t, fixture("gps.jpg"), "image/jpeg");
    vi.spyOn(Jimp.prototype, "getBuffer").mockResolvedValue(
      Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1),
    );

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationLabel).toBe("invalid_image");
    expect(row.moderationReason).toBe("too_large");
    expect(row.fileId).toBe(fileId);
    expect(row.reencodedAt).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
    const stored = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(stored).toEqual([]);
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
