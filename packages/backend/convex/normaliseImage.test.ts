import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Jimp } from "jimp";
import { describe, expect, test } from "vitest";
import { readImageDimensions } from "./lib/imageModeration/guards";
import {
  decodeUpright,
  stripAndNormalise,
} from "./lib/imageModeration/normaliseImage";
import { findMetadata } from "./lib/imageModeration/stripMetadata";
import { WEBP_DECODER_WASM_BASE64 } from "./lib/imageModeration/webpDecoderWasm";

// Turning images upright for their Exif Orientation, on real files. The fixtures
// (test-fixtures/images/orientation, written by Pillow: see generate.py there) all SHOW the same
// 24x16 picture, a 3x2 grid of solid 8x8 blocks (UPRIGHT), but store its pixels turned the
// other way with Orientation n = 1..8 in their Exif (5..8 are stored 16x24), as JPEG, PNG and
// lossless WebP. Normalised, every one must come out 24x16 with each block in its place.

const UPRIGHT = [
  [0xff0000, 0x00ff00, 0x0000ff],
  [0xffff00, 0xff00ff, 0x00ffff],
];

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`../test-fixtures/images/orientation/${name}`, import.meta.url),
    ),
  );

// The RGBA bytes of the pixel in the middle of each 8x8 block, row by row.
const blockCentres = (bitmap: { width: number; data: Uint8Array | Buffer }) =>
  UPRIGHT.map((row, r) =>
    row.map((_, c) => {
      const i = ((r * 8 + 4) * bitmap.width + (c * 8 + 4)) * 4;
      return Array.from(bitmap.data.subarray(i, i + 4));
    }),
  );

const expectUpright = (
  bitmap: { width: number; height: number; data: Uint8Array | Buffer },
  { tolerance, alpha = 255 }: { tolerance: number; alpha?: number },
) => {
  expect([bitmap.width, bitmap.height]).toEqual([24, 16]);
  const centres = blockCentres(bitmap);
  UPRIGHT.forEach((row, r) =>
    row.forEach((rgb, c) => {
      const want = [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, alpha];
      centres[r][c].forEach((value, k) =>
        expect(Math.abs(value - want[k])).toBeLessThanOrEqual(tolerance),
      );
    }),
  );
};

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("stripAndNormalise", () => {
  test.each(ORIENTATIONS)(
    "PNG with Orientation %i comes out upright, as PNG",
    async (n) => {
      const original = fixture(`${n}.png`);
      expect(readImageDimensions(original, "png")).toEqual(
        n >= 5 ? { width: 16, height: 24 } : { width: 24, height: 16 },
      );

      const clean = (await stripAndNormalise(original, "png"))!;

      expect(clean.mime).toBe("image/png");
      expect(clean.normalised).toBe(n !== 1);
      expect(findMetadata(clean.bytes, "png")).toEqual([]);
      expect(readImageDimensions(clean.bytes, "png")).toEqual({
        width: 24,
        height: 16,
      });
      // PNG is lossless: every block is exactly its colour.
      expectUpright((await Jimp.read(Buffer.from(clean.bytes))).bitmap, {
        tolerance: 0,
      });
    },
  );

  test.each(ORIENTATIONS)(
    "JPEG with Orientation %i comes out upright, as JPEG without Exif",
    async (n) => {
      const original = fixture(`${n}.jpg`);
      expect(findMetadata(original, "jpeg")).toEqual(["exif"]);

      const clean = (await stripAndNormalise(original, "jpeg"))!;

      expect(clean.mime).toBe("image/jpeg");
      expect(clean.normalised).toBe(n !== 1);
      expect(findMetadata(clean.bytes, "jpeg")).toEqual([]);
      expect(readImageDimensions(clean.bytes, "jpeg")).toEqual({
        width: 24,
        height: 16,
      });
      expectUpright((await Jimp.read(Buffer.from(clean.bytes))).bitmap, {
        tolerance: 12,
      });
    },
  );

  test.each(ORIENTATIONS)(
    "WebP with Orientation %i comes out upright (turned: as JPEG)",
    async (n) => {
      const original = fixture(`${n}.webp`);
      expect(findMetadata(original, "webp")).toEqual(["exif"]);

      const clean = (await stripAndNormalise(original, "webp"))!;

      expect(clean.normalised).toBe(n !== 1);
      // Upright already: the stripped WebP; turned: re-encoded (jimp has no WebP encoder).
      expect(clean.mime).toBe(n === 1 ? "image/webp" : "image/jpeg");
      expect(findMetadata(clean.bytes, clean.format)).toEqual([]);
      expect(readImageDimensions(clean.bytes, clean.format)).toEqual({
        width: 24,
        height: 16,
      });
      const decoded = await decodeUpright(clean.bytes, clean.format, 1);
      expectUpright(decoded.bitmap, { tolerance: n === 1 ? 0 : 12 });
    },
  );

  test("a turned WebP with transparency comes out as PNG, alpha kept", async () => {
    const clean = (await stripAndNormalise(fixture("6-alpha.webp"), "webp"))!;

    expect(clean.mime).toBe("image/png");
    expect(findMetadata(clean.bytes, "png")).toEqual([]);
    expectUpright((await Jimp.read(Buffer.from(clean.bytes))).bitmap, {
      // Lossless, but the colour of a half-transparent pixel is premultiplied on the way.
      tolerance: 2,
      alpha: 128,
    });
  });

  test("Orientation 1 is the stripped bytes, not re-encoded", async () => {
    for (const [name, format] of [
      ["1.jpg", "jpeg"],
      ["1.png", "png"],
      ["1.webp", "webp"],
    ] as const) {
      const original = fixture(name);
      const clean = (await stripAndNormalise(original, format))!;
      expect(clean.normalised).toBe(false);
      // Only the Exif block is gone.
      expect(clean.bytes.length).toBeLessThan(original.length);
      expect(clean.bytes.length).toBeGreaterThan(original.length - 60);
    }
  });

  test("a turned JPEG keeps its RGB ICC profile (and only that)", async () => {
    const original = fixture("6.jpg");
    // An APP2 ICC_PROFILE segment (1 of 1) whose profile declares colour space RGB.
    const payload = new TextEncoder().encode(
      `ICC_PROFILE\0\x01\x01${"\0".repeat(16)}RGB fixture profile`,
    );
    const icc = new Uint8Array([0xff, 0xe2, 0, payload.length + 2, ...payload]);
    const withIcc = new Uint8Array([
      ...original.subarray(0, 2),
      ...icc,
      ...original.subarray(2),
    ]);

    const clean = (await stripAndNormalise(withIcc, "jpeg"))!;

    expect(clean.normalised).toBe(true);
    expect(findMetadata(clean.bytes, "jpeg")).toEqual([]);
    const latin1 = String.fromCharCode(...clean.bytes);
    expect(latin1).toContain(String.fromCharCode(...icc));
    expect(latin1).not.toContain("Exif");
    expectUpright((await Jimp.read(Buffer.from(clean.bytes))).bitmap, {
      tolerance: 12,
    });
  });

  test("an image that needs turning but does not decode throws", async () => {
    const original = fixture("6.webp");
    // Corrupt the VP8L bitstream (after its chunk header), keeping the chunk structure intact.
    const broken = original.slice();
    const vp8l = String.fromCharCode(...broken).indexOf("VP8L");
    broken.fill(0xff, vp8l + 8, vp8l + 8 + 40);
    await expect(stripAndNormalise(broken, "webp")).rejects.toThrow();
  });

  test("a malformed block structure is null", async () => {
    expect(
      await stripAndNormalise(fixture("6.png").subarray(0, 40), "png"),
    ).toBeNull();
  });
});

test("the embedded WebP decoder is the installed @jsquash/webp one", () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"),
  );
  expect(WEBP_DECODER_WASM_BASE64).toBe(wasm.toString("base64"));
});
