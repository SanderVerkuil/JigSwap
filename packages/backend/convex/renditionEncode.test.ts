import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Jimp } from "jimp";
import { describe, expect, test } from "vitest";
import { checkImageBytes } from "./lib/imageModeration/guards";
import { decodeUpright } from "./lib/imageModeration/normaliseImage";
import {
  encodeRenditions,
  RENDITION_LADDER,
  RENDITION_MAX_BYTE_RATIO,
  renditionSizes,
} from "./lib/imageModeration/renditionEncode";
import { findMetadata } from "./lib/imageModeration/stripMetadata";
import { WEBP_ENCODER_WASM_BASE64 } from "./lib/imageModeration/webpEncoderWasm";

// Renditions: the smaller WebP copies of a stored image that cards and thumbnails show. They
// are made from the stored clean blob through the moderation pipeline's input guards, are
// downscaled without aliasing, keep transparency and never carry metadata. The ladder is 480,
// 640 and 960 px; a source narrower than a rung gets a WebP at its own width in that rung's
// place, and a rendition not clearly smaller than its source is not kept.

// A deterministic photo-like picture: smooth gradients plus pseudo-random grain, so the JPEG
// and its WebP renditions have realistic sizes (a flat colour compresses to nothing).
const photoBitmap = (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grain = (seed >> 16) % 48;
      const i = (y * width + x) * 4;
      data[i] = ((x * 255) / width + grain) & 0xff;
      data[i + 1] = ((y * 255) / height + grain) & 0xff;
      data[i + 2] = (((x + y) * 127) / (width + height) + grain) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
};

const jpeg = async (width: number, height: number, quality = 90) =>
  new Uint8Array(
    await Jimp.fromBitmap(photoBitmap(width, height)).getBuffer("image/jpeg", {
      quality,
    }),
  );

const sizesOf = (
  renditions: { slot: string; width: number; height: number }[],
) => renditions.map((r) => [r.slot, r.width, r.height]);

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );

const text = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

const ok = async (bytes: Uint8Array) => {
  const result = await encodeRenditions(bytes);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};

describe("renditionSizes", () => {
  test("one per rung narrower than the image, aspect kept", () => {
    expect(RENDITION_LADDER).toEqual([
      { slot: "small", width: 480 },
      { slot: "medium", width: 640 },
      { slot: "large", width: 960 },
    ]);
    expect(renditionSizes(1600, 1200)).toEqual([
      { slot: "small", width: 480, height: 360 },
      { slot: "medium", width: 640, height: 480 },
      { slot: "large", width: 960, height: 720 },
    ]);
  });

  test("the first rung as wide as the image or wider is made at the image's own width", () => {
    // An 833 px cover: 480 and 640, then a WebP at 833 px in place of 960, so a card that needs
    // more than 640 px never falls back to the (possibly PNG) original.
    expect(renditionSizes(833, 1024)).toEqual([
      { slot: "small", width: 480, height: 590 },
      { slot: "medium", width: 640, height: 787 },
      { slot: "large", width: 833, height: 1024 },
    ]);
    expect(renditionSizes(960, 720)).toEqual([
      { slot: "small", width: 480, height: 360 },
      { slot: "medium", width: 640, height: 480 },
      { slot: "large", width: 960, height: 720 },
    ]);
    expect(renditionSizes(560, 420)).toEqual([
      { slot: "small", width: 480, height: 360 },
      { slot: "medium", width: 560, height: 420 },
    ]);
    expect(renditionSizes(400, 3000)).toEqual([
      { slot: "small", width: 400, height: 3000 },
    ]);
  });

  test("a size whose height WebP cannot hold (over 16383 px) is left out", () => {
    expect(renditionSizes(970, 16600)).toEqual([
      { slot: "small", width: 480, height: 8214 },
      { slot: "medium", width: 640, height: 10953 },
    ]);
    expect(renditionSizes(400, 20000)).toEqual([]);
  });

  test("a very wide image still gets at least one row", () => {
    expect(renditionSizes(20000, 10)).toEqual([
      { slot: "small", width: 480, height: 1 },
      { slot: "medium", width: 640, height: 1 },
      { slot: "large", width: 960, height: 1 },
    ]);
  });
});

describe("encodeRenditions", () => {
  test("a 1600x1200 JPEG gives 480, 640 and 960 px WebP, much smaller than the source", async () => {
    const source = await jpeg(1600, 1200);
    const result = await ok(source);
    expect([result.width, result.height]).toEqual([1600, 1200]);
    expect(sizesOf(result.renditions)).toEqual([
      ["small", 480, 360],
      ["medium", 640, 480],
      ["large", 960, 720],
    ]);
    expect(result.notSmaller).toEqual([]);
    for (const rendition of result.renditions) {
      // The header the guards read agrees, and the existing WASM decoder reads the pixels back.
      expect(checkImageBytes(rendition.bytes)).toEqual({
        ok: true,
        format: "webp",
        width: rendition.width,
        height: rendition.height,
      });
      const decoded = await decodeUpright(rendition.bytes, "webp", 1);
      expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([
        rendition.width,
        rendition.height,
      ]);
      expect(findMetadata(rendition.bytes, "webp")).toEqual([]);
    }
    const [small, medium, large] = result.renditions;
    expect(small.bytes.length).toBeLessThan(source.length / 8);
    expect(medium.bytes.length).toBeLessThan(source.length / 5);
    expect(large.bytes.length).toBeLessThan(source.length / 3);
  });

  test("a PNG with transparent pixels keeps its alpha", async () => {
    const width = 1200;
    const height = 800;
    const bitmap = photoBitmap(width, height);
    // Left half fully transparent, a half-transparent band across the right half.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (x < width / 2) bitmap.data[i + 3] = 0;
        else if (y >= 300 && y < 500) bitmap.data[i + 3] = 128;
      }
    }
    const source = new Uint8Array(
      await Jimp.fromBitmap(bitmap).getBuffer("image/png"),
    );
    const result = await ok(source);
    expect(sizesOf(result.renditions)).toEqual([
      ["small", 480, 320],
      ["medium", 640, 427],
      ["large", 960, 640],
    ]);
    for (const rendition of result.renditions) {
      const { bitmap: out } = await decodeUpright(rendition.bytes, "webp", 1);
      const alphaAt = (fx: number, fy: number) =>
        out.data[
          (Math.floor(fy * out.height) * out.width +
            Math.floor(fx * out.width)) *
            4 +
            3
        ];
      expect(alphaAt(0.25, 0.1)).toBe(0);
      expect(alphaAt(0.75, 0.1)).toBe(255);
      expect(Math.abs(alphaAt(0.75, 0.5) - 128)).toBeLessThanOrEqual(8);
    }
    // A WebP with alpha is far smaller than the lossless PNG it came from.
    expect(result.renditions[2].bytes.length).toBeLessThan(source.length / 4);
  });

  test("a PNG narrower than 960 px gets a WebP at its own width, far smaller than the PNG", async () => {
    // The shape of the live catalogue's heaviest cover: an 833x1024 PNG.
    const source = new Uint8Array(
      await Jimp.fromBitmap(photoBitmap(833, 1024)).getBuffer("image/png"),
    );
    const result = await ok(source);
    expect(sizesOf(result.renditions)).toEqual([
      ["small", 480, 590],
      ["medium", 640, 787],
      ["large", 833, 1024],
    ]);
    expect(result.renditions[2].bytes.length).toBeLessThan(source.length / 4);
  });

  test("fine detail is averaged, not aliased (a 1 px checkerboard turns grey)", async () => {
    const width = 1600;
    const height = 1200;
    const data = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((x + y) % 2 === 0)
          data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
    const source = new Uint8Array(
      await Jimp.fromBitmap({ width, height, data }).getBuffer("image/png"),
    );
    const result = await ok(source);
    for (const rendition of result.renditions) {
      const { bitmap: out } = await decodeUpright(rendition.bytes, "webp", 1);
      let min = 255;
      let max = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        min = Math.min(min, out.data[i]);
        max = Math.max(max, out.data[i]);
      }
      // Nearest-neighbour and bilinear sampling keep pure black (0); jimp's bicubic and hermite
      // modes leave near-black pixels too (14 and 28 here).
      expect(min).toBeGreaterThan(64);
      expect(max).toBeLessThan(192);
    }
  });

  test("a source no wider than 480 px gets one WebP at its own width", async () => {
    const source = await jpeg(400, 600);
    const result = await ok(source);
    expect([result.width, result.height]).toEqual([400, 600]);
    expect(sizesOf(result.renditions)).toEqual([["small", 400, 600]]);
    expect(result.renditions[0].bytes.length).toBeLessThanOrEqual(
      source.length * RENDITION_MAX_BYTE_RATIO,
    );
  });

  test("a 700 px source gets 480 and 640 px renditions and one at its own width", async () => {
    const result = await ok(await jpeg(700, 500));
    expect(sizesOf(result.renditions)).toEqual([
      ["small", 480, 343],
      ["medium", 640, 457],
      ["large", 700, 500],
    ]);
  });

  test("a rendition that is not clearly smaller than its source is not kept", async () => {
    // A heavily compressed JPEG: a WebP at (nearly) its own width costs about as many bytes.
    const source = await jpeg(1000, 750, 20);
    const result = await ok(source);
    expect(result.notSmaller).toContain("large");
    expect(result.renditions.map((r) => r.slot)).not.toContain("large");
    for (const rendition of result.renditions) {
      expect(rendition.bytes.length).toBeLessThanOrEqual(
        source.length * RENDITION_MAX_BYTE_RATIO,
      );
    }
  });

  test("an upright WebP source works too", async () => {
    const webp = (await ok(await jpeg(1600, 1200))).renditions[2].bytes;
    const result = await ok(webp);
    expect([result.width, result.height]).toEqual([960, 720]);
    expect(sizesOf(result.renditions).slice(0, 2)).toEqual([
      ["small", 480, 360],
      ["medium", 640, 480],
    ]);
  });

  test("metadata never reaches a rendition, and it follows the picture as shown", async () => {
    // Splice gps.jpg's metadata segments (Exif with GPS and Orientation 6, XMP, IPTC, a
    // comment) into a 1600x1200 JPEG, right after its SOI.
    const gps = fixture("gps.jpg");
    let end = 2;
    while (
      gps[end] === 0xff &&
      gps[end + 1] !== 0xdb &&
      gps[end + 1] !== 0xc0
    ) {
      end += 2 + ((gps[end + 2] << 8) | gps[end + 3]);
    }
    const plain = await jpeg(1600, 1200);
    const source = new Uint8Array(plain.length + end - 2);
    source.set(plain.subarray(0, 2));
    source.set(gps.subarray(2, end), 2);
    source.set(plain.subarray(2), end);
    expect(text(source)).toContain("FixtureCam");

    const result = await ok(source);
    // Shown turned a quarter (Orientation 6), as a browser shows the stored original.
    expect([result.width, result.height]).toEqual([1200, 1600]);
    expect(sizesOf(result.renditions)).toEqual([
      ["small", 480, 640],
      ["medium", 640, 853],
      ["large", 960, 1280],
    ]);
    for (const rendition of result.renditions) {
      expect(findMetadata(rendition.bytes, "webp")).toEqual([]);
      for (const secret of [
        "FixtureCam",
        "Utrecht",
        "52,5.2057N",
        "ns.adobe.com",
      ]) {
        expect(text(rendition.bytes)).not.toContain(secret);
      }
    }
  });

  test("bytes the input guards refuse are never decoded", async () => {
    expect(
      await encodeRenditions(new TextEncoder().encode("<svg></svg>")),
    ).toEqual({ ok: false, reason: "unsupported_format" });
    // A PNG header claiming 6000x6000 (36 MP) over no pixels: refused on the header alone.
    const bomb = new Uint8Array(
      await Jimp.fromBitmap(photoBitmap(8, 8)).getBuffer("image/png"),
    );
    new DataView(bomb.buffer).setUint32(16, 6000);
    new DataView(bomb.buffer).setUint32(20, 6000);
    expect(await encodeRenditions(bomb)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
  });

  test("a header over a body that does not decode is decode_failed", async () => {
    const source = await jpeg(1600, 1200);
    expect(await encodeRenditions(source.subarray(0, 700))).toEqual({
      ok: false,
      reason: "decode_failed",
    });
  });
});

test("the embedded WebP encoder is the installed @jsquash/webp (non-SIMD) one", () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    require.resolve("@jsquash/webp/codec/enc/webp_enc.wasm"),
  );
  expect(WEBP_ENCODER_WASM_BASE64).toBe(wasm.toString("base64"));
});
