import { readFileSync } from "node:fs";
import { Jimp } from "jimp";
import { describe, expect, test } from "vitest";
import {
  appExtensionDifferentialGif,
  craftGif,
  gifApplication,
  gifComment,
  gifControl,
  gifFrame,
  gifNetscapeLoop,
} from "../test-fixtures/craftGif";
import { progressiveJpeg } from "../test-fixtures/craftJpeg";
import {
  craftPng,
  iendChunk,
  ihdrChunk,
  pngChunk,
  transparentIdat,
  transparentPng,
} from "../test-fixtures/craftPng";
import {
  checkImageBytes,
  checkImageSize,
  gifDecodeInput,
  jpegDecodeInput,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_JPEG_BLOCKS,
  MAX_JPEG_SCANS,
  readImageDimensions,
  sniffImageFormat,
} from "./lib/imageModeration/guards";

// Unit tests for the moderation pipeline's input guards: pure functions on byte buffers.

const bytesOf = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const ch of part) out.push(ch.charCodeAt(0));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
};

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32be = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
const u32le = (n: number) => [...u16le(n & 0xffff), ...u16le(n >>> 16)];

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngHeader = (width: number, height: number) =>
  bytesOf(
    PNG_SIG,
    u32be(13),
    "IHDR",
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0],
  );

// A JPEG frame header (SOF0 unless `marker` says otherwise) with one component per sampling
// factor byte (horizontal << 4 | vertical): [0x22, 0x11, 0x11] is 4:2:0, [0x11, 0x11, 0x11] 4:4:4.
const sof = (
  width: number,
  height: number,
  sampling: number[],
  marker = 0xc0,
) =>
  bytesOf(
    [0xff, marker],
    u16be(8 + 3 * sampling.length),
    [8],
    u16be(height),
    u16be(width),
    [sampling.length],
    sampling.flatMap((hv, c) => [c + 1, hv, 0]),
  );

// A JPEG marker segment: marker, length, payload.
const segment = (marker: number, ...payload: (number[] | string)[]) => {
  const body = bytesOf(...payload);
  return bytesOf([0xff, marker], u16be(body.length + 2), Array.from(body));
};

const APP0_JFIF = segment(0xe0, "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

// A JPEG with an APP0 segment before a 4:2:0 baseline frame header (SOF0).
const jpegHeader = (width: number, height: number) =>
  bytesOf(
    [0xff, 0xd8],
    Array.from(APP0_JFIF),
    Array.from(sof(width, height, [0x22, 0x11, 0x11])),
  );

// SOI, then the given segments.
const jpegOf = (...segments: Uint8Array[]) =>
  bytesOf([0xff, 0xd8], ...segments.map((s) => Array.from(s)));

// A GIF with a 2-colour global table, a graphic-control extension and a first frame at
// (left, top) of the given size (default: the full screen).
const gifHeader = (
  width: number,
  height: number,
  frame: { left?: number; top?: number; width?: number; height?: number } = {},
) =>
  bytesOf(
    "GIF89a",
    u16le(width),
    u16le(height),
    [0x80, 0, 0],
    [0, 0, 0, 255, 255, 255],
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c],
    u16le(frame.left ?? 0),
    u16le(frame.top ?? 0),
    u16le(frame.width ?? width),
    u16le(frame.height ?? height),
    [0],
    [2, 2, 0x4c, 0x01, 0],
    [0x3b],
  );

const webpVp8 = (width: number, height: number) =>
  bytesOf(
    "RIFF",
    [0, 0, 0, 0],
    "WEBPVP8 ",
    [0, 0, 0, 0],
    [0, 0, 0],
    [0x9d, 0x01, 0x2a],
    u16le(width),
    u16le(height),
  );

const webpVp8l = (width: number, height: number) => {
  const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
  return bytesOf(
    "RIFF",
    [0, 0, 0, 0],
    "WEBPVP8L",
    [0, 0, 0, 0],
    [0x2f],
    [
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
    ],
  );
};

// A WebP chunk: its FourCC, size and payload, padded to an even length.
const webpChunk = (type: string, ...payload: (number[] | string)[]) => {
  const body = Array.from(bytesOf(...payload));
  return bytesOf(type, u32le(body.length), body, body.length % 2 ? [0] : []);
};
// "RIFF", its size, "WEBP", then the chunks.
const webpOf = (...chunks: Uint8Array[]) => {
  const body = chunks.flatMap((chunk) => Array.from(chunk));
  return bytesOf("RIFF", u32le(4 + body.length), "WEBP", body);
};
// A VP8X header (flags 0x02: animation) for a canvas of the given size.
const vp8x = (width: number, height: number, flags = 0) =>
  webpChunk("VP8X", [flags, 0, 0, 0], u24le(width - 1), u24le(height - 1));
// The start of a VP8L (lossless) bitstream of the given size.
const vp8l = (width: number, height: number) =>
  webpChunk("VP8L", [0x2f], u32le(((width - 1) | ((height - 1) << 14)) >>> 0));
// An animation frame of the given size at (0, 0), its bitstream and any chunks after it.
const anmf = (width: number, height: number, ...inner: Uint8Array[]) =>
  webpChunk(
    "ANMF",
    u24le(0),
    u24le(0),
    u24le(width - 1),
    u24le(height - 1),
    u24le(100),
    [0],
    ...[vp8l(width, height), ...inner].map((chunk) => Array.from(chunk)),
  );
const anim = () => webpChunk("ANIM", [0, 0, 0, 0], u16le(0));

// An extended (VP8X) WebP with a lossless bitstream of its canvas size.
const webpVp8x = (width: number, height: number) =>
  webpOf(vp8x(width, height), vp8l(width, height));

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );

describe("sniffImageFormat", () => {
  test("recognises JPEG, PNG, GIF and WebP by their magic bytes", () => {
    expect(sniffImageFormat(jpegHeader(1, 1))).toBe("jpeg");
    expect(sniffImageFormat(pngHeader(1, 1))).toBe("png");
    expect(sniffImageFormat(gifHeader(1, 1))).toBe("gif");
    expect(sniffImageFormat(bytesOf("GIF87a", [1, 0, 1, 0]))).toBe("gif");
    expect(sniffImageFormat(webpVp8(1, 1))).toBe("webp");
  });

  test.each([
    ["SVG", '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'],
    ["SVG with an XML prolog", '<?xml version="1.0"?><svg></svg>'],
    ["HTML", "<!DOCTYPE html><html><body>hi</body></html>"],
    ["PDF", "%PDF-1.7"],
    ["BMP", "BM\u0000\u0000"],
    ["a RIFF that is not WebP (WAV)", "RIFF\u0000\u0000\u0000\u0000WAVE"],
    ["empty", ""],
  ])("rejects %s", (_name, text) => {
    expect(sniffImageFormat(bytesOf(text))).toBeNull();
  });
});

describe("readImageDimensions", () => {
  test("reads the header of every supported format", () => {
    expect(readImageDimensions(jpegHeader(640, 480), "jpeg")).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(pngHeader(800, 600), "png")).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageDimensions(gifHeader(320, 200), "gif")).toEqual({
      width: 320,
      height: 200,
    });
    expect(readImageDimensions(webpVp8(1024, 768), "webp")).toEqual({
      width: 1024,
      height: 768,
    });
    expect(readImageDimensions(webpVp8l(300, 150), "webp")).toEqual({
      width: 300,
      height: 150,
    });
    expect(readImageDimensions(webpVp8x(9000, 7000), "webp")).toEqual({
      width: 9000,
      height: 7000,
    });
  });

  test("a GIF's first frame must lie inside the logical screen (decoder DoS)", () => {
    expect(readImageDimensions(gifHeader(10, 10), "gif")).toEqual({
      width: 10,
      height: 10,
    });
    expect(
      readImageDimensions(
        gifHeader(10, 10, { width: 60000, height: 60000 }),
        "gif",
      ),
    ).toBeNull();
    expect(
      readImageDimensions(gifHeader(10, 10, { left: 5, width: 6 }), "gif"),
    ).toBeNull();
    // A screen with no frame at all.
    expect(
      readImageDimensions(
        bytesOf("GIF89a", u16le(1), u16le(1), [0, 0, 0], [0x3b]),
        "gif",
      ),
    ).toBeNull();
    expect(checkImageBytes(gifHeader(10, 10, { height: 11 }))).toEqual({
      ok: false,
      reason: "unreadable_header",
    });
  });

  test("a GIF is walked the way omggif walks it, so the frame checked is the frame decoded (SEC-18)", () => {
    // omggif skips 17 bytes blind after an application extension whose first sub-block is not
    // the 11-byte identifier: past the 1x1 frame a size-prefixed walk meets, to a 65535x16384
    // one (1 GiB of index stream, plus whatever the LZW data fills).
    expect(
      checkImageBytes(
        appExtensionDifferentialGif({ width: 65535, height: 16384 }),
      ),
    ).toEqual({ ok: false, reason: "unreadable_header" });
    // Blocks omggif refuses: a plain text extension, any other label, and a graphic control
    // extension that is not exactly one 4-byte sub-block and its terminator.
    for (const block of [
      [0x21, 0x01, 12, ...new Array<number>(12).fill(0), 0],
      [0x21, 0x02, 1, 0, 0],
      [0x21, 0xf9, 5, 0, 0, 0, 0, 0, 0],
      [0x21, 0xf9, 4, 0, 0, 0, 0, 1, 0],
    ]) {
      expect(checkImageBytes(craftGif(4, 3, block, gifFrame(4, 3)))).toEqual({
        ok: false,
        reason: "unreadable_header",
      });
    }
    // The first frame's data must end inside the file (omggif throws otherwise).
    const truncated = craftGif(4, 3, gifFrame(4, 3)).subarray(0, -3);
    expect(checkImageBytes(truncated)).toEqual({
      ok: false,
      reason: "unreadable_header",
    });
    // What real GIFs carry before their first frame reads the same in both walks.
    expect(
      checkImageBytes(
        craftGif(
          4,
          3,
          gifNetscapeLoop(),
          gifApplication("XMP DataXMP", [1, 2, 3]),
          gifComment("made by hand"),
          gifControl(),
          gifFrame(4, 3),
          gifFrame(2, 2),
        ),
      ),
    ).toEqual({ ok: true, format: "gif", width: 4, height: 3 });
  });

  test("reads real jimp-encoded JPEG and PNG files", async () => {
    const image = new Jimp({ width: 37, height: 21, color: 0x336699ff });
    const jpeg = new Uint8Array(await image.getBuffer("image/jpeg"));
    const png = new Uint8Array(await image.getBuffer("image/png"));
    expect(readImageDimensions(jpeg, "jpeg")).toEqual({
      width: 37,
      height: 21,
    });
    expect(readImageDimensions(png, "png")).toEqual({ width: 37, height: 21 });
    const gif = new Uint8Array(await image.getBuffer("image/gif"));
    expect(readImageDimensions(gif, "gif")).toEqual({ width: 37, height: 21 });
  });

  test("a truncated or zero-sized header has no dimensions", () => {
    expect(readImageDimensions(bytesOf([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
    expect(readImageDimensions(bytesOf(PNG_SIG), "png")).toBeNull();
    expect(readImageDimensions(pngHeader(0, 10), "png")).toBeNull();
    expect(readImageDimensions(bytesOf("GIF89a"), "gif")).toBeNull();
    expect(
      readImageDimensions(bytesOf("RIFF", [0, 0, 0, 0], "WEBPXXXX"), "webp"),
    ).toBeNull();
    // A JPEG that reaches start-of-scan without a frame header.
    expect(
      readImageDimensions(bytesOf([0xff, 0xd8, 0xff, 0xda], u16be(2)), "jpeg"),
    ).toBeNull();
  });
});

describe("checkImageBytes", () => {
  test("accepts a supported image within the pixel budget", () => {
    // 12 MP phone photos (4:2:0): an iPhone's 4032 x 3024 and a Pixel's 4080 x 3072, and an
    // image of exactly MAX_IMAGE_PIXELS.
    expect(checkImageBytes(jpegHeader(4032, 3024))).toEqual({
      ok: true,
      format: "jpeg",
      width: 4032,
      height: 3024,
    });
    expect(checkImageBytes(jpegHeader(4080, 3072))).toEqual({
      ok: true,
      format: "jpeg",
      width: 4080,
      height: 3072,
    });
    expect(checkImageBytes(pngHeader(4000, 3135))).toEqual({
      ok: true,
      format: "png",
      width: 4000,
      height: 3135,
    });
  });

  test("refuses unsupported formats, including SVG and HTML", () => {
    expect(checkImageBytes(bytesOf("<svg></svg>"))).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
    expect(checkImageBytes(bytesOf("<html></html>"))).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
  });

  test("refuses a decompression bomb from the header alone (> 12.54 MP)", () => {
    // Measured: re-encoding a 12.54 MP image peaks under 512 MiB; a 25 MP one does not (SEC-18).
    expect(MAX_IMAGE_PIXELS).toBe(12_540_000);
    // 4181 x 3000 is just over the budget; the file itself is a few dozen bytes. So is the
    // review's 5000 x 5000 JPEG, which was OOM-killed on every attempt.
    for (const bomb of [
      pngHeader(4181, 3000),
      jpegHeader(4181, 3000),
      jpegHeader(5000, 5000),
      gifHeader(65535, 65535),
      webpVp8x(16383, 16383),
    ]) {
      expect(checkImageBytes(bomb)).toEqual({
        ok: false,
        reason: "too_many_pixels",
      });
    }
  });

  test("refuses a supported format with an unusable header", () => {
    expect(checkImageBytes(bytesOf(PNG_SIG))).toEqual({
      ok: false,
      reason: "unreadable_header",
    });
  });

  // jpeg-js (jimp's JPEG decoder) allocates its 8x8 blocks as soon as it meets a frame header,
  // for every frame header it meets, at about 800 bytes each in V8: the pixel count alone does
  // not bound a JPEG's decode. The guard counts the blocks of the one frame header the decoder
  // can meet, and refuses a JPEG in which it could meet two (SEC-18).
  describe("a JPEG is bounded by the blocks its one frame header makes the decoder allocate", () => {
    test("a 4:4:4 frame needs twice the blocks of a 4:2:0 one of the same size", () => {
      expect(MAX_JPEG_BLOCKS).toBe(296_000);
      expect(
        checkImageBytes(jpegOf(sof(4032, 3024, [0x11, 0x11, 0x11]))),
      ).toEqual({ ok: false, reason: "too_many_pixels" });
      expect(
        checkImageBytes(jpegOf(sof(2880, 2160, [0x11, 0x11, 0x11]))),
      ).toEqual({ ok: true, format: "jpeg", width: 2880, height: 2160 });
      // Four components (CMYK) at 4:4:4: 2520 x 1880 needs 296,100 blocks.
      expect(
        checkImageBytes(jpegOf(sof(2520, 1880, [0x11, 0x11, 0x11, 0x11]))),
      ).toEqual({ ok: false, reason: "too_many_pixels" });
    });

    test("a narrow frame counts the blocks its sampling pads it to", () => {
      // Sampled 4x4, every 32 x 32 pixels take 16 blocks per component, however few of them
      // the image covers: 96 x 65535 is 6.3 MP but 393,216 blocks.
      expect(
        checkImageBytes(jpegOf(sof(96, 65535, [0x44, 0x44, 0x44, 0x44]))),
      ).toEqual({ ok: false, reason: "too_many_pixels" });
      expect(
        checkImageBytes(jpegOf(sof(32, 65535, [0x44, 0x44, 0x44, 0x44]))),
      ).toEqual({ ok: true, format: "jpeg", width: 32, height: 65535 });
    });

    test("more than four components, or a sampling factor outside 1..4, is refused", () => {
      // A 779-byte file of 1 x 65535 pixels whose 255 components, sampled 15x15 each, make
      // jpeg-js allocate over 1 GiB before it gives up: it passed the pixel guard and was
      // OOM-killed on every attempt.
      const crash = jpegOf(
        sof(1, 65535, new Array<number>(255).fill(0xff)),
        bytesOf([0xff, 0xd9]),
      );
      expect(crash.length).toBe(779);
      for (const bytes of [
        crash,
        jpegOf(sof(64, 64, [0x11, 0x11, 0x11, 0x11, 0x11])),
        jpegOf(sof(64, 64, [0x51, 0x11, 0x11])),
        jpegOf(sof(64, 64, [0x10, 0x11, 0x11])),
        jpegOf(sof(64, 64, [])),
      ]) {
        expect(checkImageBytes(bytes)).toEqual({
          ok: false,
          reason: "unreadable_header",
        });
      }
    });

    test("a second frame header is refused, wherever it sits", () => {
      const frame = sof(64, 64, [0x22, 0x11, 0x11]);
      const big = sof(4000, 3000, [0x11, 0x11, 0x11], 0xc2);
      const sos = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
      for (const bytes of [
        jpegOf(frame, big),
        // Inside a table segment: jpeg-js reads tables by their content, not their length.
        jpegOf(
          segment(0xdb, [0], new Array<number>(64).fill(1), Array.from(big)),
          frame,
        ),
        // After a scan.
        jpegOf(frame, sos, bytesOf([0x12, 0x34]), big),
      ]) {
        expect(checkImageBytes(bytes)).toEqual({
          ok: false,
          reason: "unreadable_header",
        });
      }
    });

    // jpeg-js walks every block on each scan, whatever is in it, so a progressive JPEG under a
    // megabyte can hold a moderation slot for ten minutes: a scan costs 28 bytes of file. Pixels and
    // blocks don't bound that. A normal progressive JPEG has about ten scans.
    test("more scans than any real JPEG has are refused, before decoding", () => {
      const of = (scans: number) =>
        progressiveJpeg({ width: 3538, height: 3538, scans });
      expect(MAX_JPEG_SCANS).toBe(32);
      expect(checkImageBytes(of(10))).toEqual({
        ok: true,
        format: "jpeg",
        width: 3538,
        height: 3538,
      });
      expect(checkImageBytes(of(MAX_JPEG_SCANS)).ok).toBe(true);
      for (const scans of [MAX_JPEG_SCANS + 1, 100, 22_000]) {
        const bomb = of(scans);
        expect(bomb.length).toBeLessThan(MAX_IMAGE_UPLOAD_BYTES);
        expect(checkImageBytes(bomb)).toEqual({
          ok: false,
          reason: "too_many_pixels",
        });
      }
    });

    test("a scan in an APPn segment isn't counted; one after a fill byte is", () => {
      const scan = (count: number) =>
        Array.from({ length: count }, () =>
          Array.from(segment(0xda, [1, 1, 0x00, 1, 63, 0x10])),
        ).flat();
      const frame = sof(64, 64, [0x11]);
      expect(
        checkImageBytes(
          jpegOf(
            frame,
            segment(0xe1, scan(MAX_JPEG_SCANS + 1)),
            bytesOf(scan(1)),
          ),
        ).ok,
      ).toBe(true);
      expect(
        checkImageBytes(
          jpegOf(
            frame,
            bytesOf(scan(MAX_JPEG_SCANS)),
            // Fill bytes before a marker: the decoder's walk still lands on it.
            bytesOf([0xff, 0xff], scan(1)),
          ),
        ).ok,
      ).toBe(false);
    });

    test("a frame header inside an APPn or COM segment is not part of the decode", () => {
      // An Exif thumbnail is a whole JPEG, frame header included. The decoder is never given
      // APPn or COM segments (jpegDecodeInput).
      const thumbnail = jpegOf(sof(160, 120, [0x22, 0x11, 0x11]));
      const exif = segment(0xe1, "Exif\0\0", Array.from(thumbnail));
      const icc = segment(
        0xe2,
        "ICC_PROFILE\0",
        [1, 1, 0xff, 0xc0, 0xff, 0xc2],
      );
      const comment = segment(0xfe, [0xff, 0xc1]);
      const frame = sof(640, 480, [0x22, 0x11, 0x11]);

      expect(
        checkImageBytes(jpegOf(APP0_JFIF, exif, icc, comment, frame)),
      ).toEqual({ ok: true, format: "jpeg", width: 640, height: 480 });
    });

    test("the decoder is given the frame, tables and scans, and Adobe's colour transform only", () => {
      const adobe = segment(0xee, "Adobe", [0, 100, 0, 0, 0, 0, 1]);
      const dqt = segment(0xdb, [0], new Array<number>(64).fill(1));
      const frame = sof(16, 16, [0x11]);
      const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
      // Entropy-coded data: a stuffed 0xFF00 and a restart marker are part of it.
      const scan = bytesOf([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
      const eoi = bytesOf([0xff, 0xd9]);
      const file = jpegOf(
        APP0_JFIF,
        segment(0xe1, "Exif\0\0", [1, 2]),
        adobe,
        segment(0xfe, "hi"),
        dqt,
        frame,
        sos,
        scan,
        eoi,
        bytesOf("appended"),
      );

      expect(Array.from(jpegDecodeInput(file))).toEqual(
        Array.from(jpegOf(adobe, dqt, frame, sos, scan, eoi)),
      );
    });
  });

  // omggif (jimp's GIF decoder) must decode the frame the guard checked, whatever it would make
  // of the blocks around it: it is given only that frame (SEC-18).
  describe("the GIF decoder is given the checked first frame alone", () => {
    test("extensions and later frames are dropped; the last graphic control before the frame stays", () => {
      const transparentControl = [0x21, 0xf9, 4, 0x01, 0, 0, 1, 0];
      const file = craftGif(
        4,
        3,
        gifNetscapeLoop(),
        gifControl(),
        gifApplication("XMP DataXMP", [1, 2, 3]),
        transparentControl,
        gifComment("made by hand"),
        gifFrame(4, 3),
        gifControl(),
        gifFrame(2, 2),
      );

      expect(Array.from(gifDecodeInput(file))).toEqual(
        Array.from(craftGif(4, 3, transparentControl, gifFrame(4, 3))),
      );
      expect(
        Array.from(gifDecodeInput(craftGif(4, 3, gifFrame(4, 3)))),
      ).toEqual(Array.from(craftGif(4, 3, gifFrame(4, 3))));
    });

    test("a GIF the guard cannot walk keeps no frame, so its decode is refused", () => {
      const input = gifDecodeInput(
        appExtensionDifferentialGif({ width: 65535, height: 16384 }),
      );
      expect(input.length).toBe(13);
      expect(checkImageBytes(input)).toEqual({
        ok: false,
        reason: "unreadable_header",
      });
    });
  });

  // pngjs (jimp's PNG decoder) takes the size from EVERY IHDR it meets, so the last one decides
  // the bitmap: the guard must see the only one there is (SEC-17).
  describe("a PNG's header is its one IHDR, first", () => {
    test("a real PNG passes", () => {
      expect(checkImageBytes(transparentPng(3, 2))).toEqual({
        ok: true,
        format: "png",
        width: 3,
        height: 2,
      });
    });

    test("a second IHDR that announces a bigger image is refused", () => {
      const dualIhdr = craftPng(
        ihdrChunk(1, 1),
        ihdrChunk(5200, 5000),
        transparentIdat(1, 1),
        iendChunk(),
      );
      expect(readImageDimensions(dualIhdr, "png")).toBeNull();
      expect(checkImageBytes(dualIhdr)).toEqual({
        ok: false,
        reason: "unreadable_header",
      });
    });

    test("an IHDR that is not the first chunk is refused", () => {
      const late = craftPng(
        pngChunk("tEXt", new TextEncoder().encode("Comment\0hi")),
        ihdrChunk(2, 2),
        transparentIdat(2, 2),
        iendChunk(),
      );
      expect(checkImageBytes(late)).toEqual({
        ok: false,
        reason: "unreadable_header",
      });
    });

    test("an IHDR of the wrong length is refused", () => {
      const long = craftPng(
        pngChunk(
          "IHDR",
          new Uint8Array([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0]),
        ),
        transparentIdat(2, 2),
        iendChunk(),
      );
      expect(checkImageBytes(long)).toEqual({
        ok: false,
        reason: "unreadable_header",
      });
    });

    test("an interlaced (Adam7) PNG is refused: its inflate is unbounded", () => {
      expect(
        checkImageBytes(transparentPng(5, 5, { interlaced: true })),
      ).toEqual({ ok: false, reason: "interlaced" });
    });

    test("anything after IEND is not part of the header walk", () => {
      const trailing = new Uint8Array([
        ...transparentPng(2, 2),
        ...ihdrChunk(5200, 5000),
      ]);
      expect(readImageDimensions(trailing, "png")).toEqual({
        width: 2,
        height: 2,
      });
    });
  });

  // libwebp (the WASM decoder) decodes one still image: the bitstream that is the first chunk,
  // or behind a VP8X header the first one after it, which must be the VP8X canvas size. It has
  // no animation support, and an animation is not what a still decode of it would show (SEC-76).
  describe("a WebP is one still image, the size of its canvas", () => {
    test("real WebP files pass: lossless and lossy, behind a VP8X header", () => {
      expect(checkImageBytes(fixture("orientation/1.webp"))).toEqual({
        ok: true,
        format: "webp",
        width: 24,
        height: 16,
      });
      expect(checkImageBytes(fixture("gps.webp"))).toEqual({
        ok: true,
        format: "webp",
        width: 40,
        height: 30,
      });
    });

    test.each([
      [
        "the VP8X animation flag, ANIM and ANMF",
        webpOf(vp8x(8, 6, 0x02), anim(), anmf(8, 6), anmf(8, 6)),
      ],
      ["the VP8X animation flag alone", webpOf(vp8x(8, 6, 0x02), vp8l(8, 6))],
      [
        "an ANMF frame behind a still VP8X header",
        webpOf(vp8x(8, 6), vp8l(8, 6), anmf(8, 6)),
      ],
      [
        "an ANMF frame after a simple lossless image",
        webpOf(vp8l(8, 6), anim(), anmf(8, 6)),
      ],
    ])("an animation is refused: %s", (_name, bytes) => {
      expect(checkImageBytes(bytes)).toEqual({
        ok: false,
        reason: "animated",
      });
    });

    test("a VP8X canvas over a bitstream of another size has no usable header", () => {
      for (const bytes of [
        // A small canvas over a big bitstream: the decoder allocates the bitstream's size.
        webpOf(vp8x(16, 16), vp8l(4000, 3000)),
        webpOf(vp8x(4000, 3000), vp8l(16, 16)),
        // No bitstream at all.
        webpOf(vp8x(16, 16)),
        webpOf(vp8x(16, 16), webpChunk("ICCP", "profile")),
        // A VP8X chunk of the wrong size.
        webpOf(
          webpChunk("VP8X", [0, 0, 0, 0], u24le(15), u24le(15), [0, 0]),
          vp8l(16, 16),
        ),
      ]) {
        expect(checkImageBytes(bytes)).toEqual({
          ok: false,
          reason: "unreadable_header",
        });
      }
    });

    test("chunks before the bitstream (ICCP, ALPH) are skipped like the decoder skips them", () => {
      expect(
        checkImageBytes(
          webpOf(
            vp8x(16, 16, 0x20),
            webpChunk("ICCP", "profile"),
            webpChunk("ALPH", [0]),
            vp8l(16, 16),
          ),
        ),
      ).toEqual({ ok: true, format: "webp", width: 16, height: 16 });
    });
  });

  // jimp has no APNG decoder (it failed such an upload as decode_failed), and a still decode
  // would not show the animation either.
  test("an APNG (an acTL chunk) is refused as animated", () => {
    const apng = craftPng(
      ihdrChunk(2, 2),
      pngChunk("acTL", new Uint8Array([0, 0, 0, 2, 0, 0, 0, 0])),
      transparentIdat(2, 2),
      iendChunk(),
    );
    expect(checkImageBytes(apng)).toEqual({ ok: false, reason: "animated" });
  });

  test("refuses more than 10 MB", () => {
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    const big = new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1);
    big.set(pngHeader(10, 10));
    expect(checkImageBytes(big)).toEqual({ ok: false, reason: "too_large" });
    expect(checkImageSize(MAX_IMAGE_UPLOAD_BYTES)).toEqual({ ok: true });
    expect(checkImageSize(MAX_IMAGE_UPLOAD_BYTES + 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
