import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { Jimp } from "jimp";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  craftGif,
  gifComment,
  gifControl,
  gifFrame,
  gifNetscapeLoop,
} from "../test-fixtures/craftGif";
import {
  craftPng,
  iendChunk,
  ihdrChunk,
  transparentIdat,
  transparentPng,
} from "../test-fixtures/craftPng";
import {
  JPEG_DECODER_MEMORY_MB,
  jpegDecodeInput,
  MAX_IMAGE_PIXELS,
  readImageDimensions,
} from "./lib/imageModeration/guards";
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

// Nothing is decoded that the input guards would refuse, and no decoder may read a different size
// from the bytes than the header the guards checked (SEC-17).
describe("decodeUpright decodes only what the guards checked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a PNG whose second IHDR announces a bigger image is never decoded", async () => {
    const decode = vi.spyOn(Jimp, "fromBuffer");
    const dualIhdr = craftPng(
      ihdrChunk(1, 1),
      ihdrChunk(64, 64),
      transparentIdat(64, 64),
      iendChunk(),
    );

    await expect(decodeUpright(dualIhdr, "png", 1)).rejects.toThrow(
      /unreadable_header/,
    );
    expect(decode).not.toHaveBeenCalled();
  });

  test("an interlaced PNG is never decoded", async () => {
    const decode = vi.spyOn(Jimp, "fromBuffer");

    await expect(
      decodeUpright(transparentPng(5, 5, { interlaced: true }), "png", 1),
    ).rejects.toThrow(/interlaced/);
    expect(decode).not.toHaveBeenCalled();
  });

  test("a decoded bitmap that is not the header's size is refused", async () => {
    // The decoder reads 64x64 where the header said 3x2.
    const bigger = await Jimp.fromBuffer(Buffer.from(transparentPng(64, 64)));
    vi.spyOn(Jimp, "fromBuffer").mockResolvedValueOnce(bigger);

    await expect(decodeUpright(transparentPng(3, 2), "png", 6)).rejects.toThrow(
      /64x64/,
    );
  });

  test("a turned image is checked before it is turned", async () => {
    // Stored 3 wide and 2 tall with Orientation 6: the header's size, upright 2x3.
    const image = await decodeUpright(transparentPng(3, 2), "png", 6);
    expect([image.bitmap.width, image.bitmap.height]).toEqual([2, 3]);
  });

  // The guards bound jpeg-js by the one frame header in the bytes they checked; the decoder must
  // get exactly those bytes, with its own allocation caps as a backstop (SEC-18).
  test("a JPEG is decoded from the bytes the guards checked, under jpeg-js's own caps", async () => {
    const decode = vi.spyOn(Jimp, "fromBuffer");
    const original = fixture("1.jpg");

    await decodeUpright(original, "jpeg", 1);

    expect(decode).toHaveBeenCalledTimes(1);
    const [input, options] = decode.mock.calls[0];
    expect(new Uint8Array(input)).toEqual(jpegDecodeInput(original));
    // Its JFIF and Exif segments are not.
    expect(input.byteLength).toBeLessThan(original.length);
    expect(options).toEqual({
      "image/jpeg": {
        maxResolutionInMP: MAX_IMAGE_PIXELS / 1e6,
        maxMemoryUsageInMB: JPEG_DECODER_MEMORY_MB,
      },
    });
    expect(JPEG_DECODER_MEMORY_MB).toBe(193);
  });

  // The guard walks a GIF as omggif does; even so, omggif is given only the frame it checked, so
  // no block around it can make omggif decode another one (SEC-18).
  test("a GIF is decoded from its checked first frame alone", async () => {
    const decode = vi.spyOn(Jimp, "fromBuffer");
    const animated = craftGif(
      4,
      3,
      gifNetscapeLoop(),
      gifComment("made by hand"),
      gifControl(),
      gifFrame(4, 3),
      gifControl(),
      gifFrame(2, 2),
    );

    const image = await decodeUpright(animated, "gif", 1);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(decode.mock.calls[0][0])).toEqual(
      craftGif(4, 3, gifControl(), gifFrame(4, 3)),
    );
    expect([image.bitmap.width, image.bitmap.height]).toEqual([4, 3]);
  });
});

// A full garbage collection on demand: V8's gc(), switched on for this file.
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

// Each WebP decode runs in a decoder instance of its own, whose heap grows to what that image
// needs and is dropped with it: a big decode never stays resident for the next one (SEC-77).
describe("the WebP decoder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("decodes WebPs one after another", async () => {
    for (const [name, orientation] of [
      ["1.webp", 1],
      ["6.webp", 6],
      ["6-alpha.webp", 6],
      ["1.webp", 1],
    ] as const) {
      const image = await decodeUpright(fixture(name), "webp", orientation);
      expectUpright(image.bitmap, {
        tolerance: 2,
        alpha: name === "6-alpha.webp" ? 128 : 255,
      });
    }
  });

  test("keeps no decoder instance, nor its heap, once its decode is done", async () => {
    const instances: WeakRef<WebAssembly.Instance>[] = [];
    const Instance = WebAssembly.Instance;
    // Every instance the decoder creates, held weakly (a vi.spyOn would keep what it returned).
    WebAssembly.Instance = new Proxy(Instance, {
      construct: (target, args: [WebAssembly.Module, WebAssembly.Imports?]) => {
        const instance = new target(...args);
        instances.push(new WeakRef(instance));
        return instance;
      },
    });
    // As in a fresh Node process: no global ImageData yet, which the decoder's glue would define
    // from inside the instance it is creating.
    const imageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
    Reflect.deleteProperty(globalThis, "ImageData");
    try {
      await decodeUpright(fixture("1.webp"), "webp", 1);
      await decodeUpright(fixture("6.webp"), "webp", 6);
    } finally {
      WebAssembly.Instance = Instance;
      if (imageData) Object.defineProperty(globalThis, "ImageData", imageData);
    }

    expect(instances).toHaveLength(2);
    // Collect in jobs of their own: a WeakRef's target is kept alive until the end of the job
    // that created or read it.
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      collectGarbage();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(instances.map((ref) => ref.deref())).toEqual([undefined, undefined]);
  });
});

test("the embedded WebP decoder is the installed @jsquash/webp one", () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"),
  );
  expect(WEBP_DECODER_WASM_BASE64).toBe(wasm.toString("base64"));
});
