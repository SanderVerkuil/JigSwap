import { Jimp } from "jimp";
import { describe, expect, test } from "vitest";
import {
  checkImageBytes,
  checkImageSize,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_UPLOAD_BYTES,
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

// A JPEG with an APP0 segment before the baseline frame header (SOF0).
const jpegHeader = (width: number, height: number) =>
  bytesOf(
    [0xff, 0xd8],
    [0xff, 0xe0],
    u16be(16),
    "JFIF",
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(height),
    u16be(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );

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

const webpVp8x = (width: number, height: number) =>
  bytesOf(
    "RIFF",
    [0, 0, 0, 0],
    "WEBPVP8X",
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    u24le(width - 1),
    u24le(height - 1),
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
    expect(checkImageBytes(jpegHeader(5000, 5000))).toEqual({
      ok: true,
      format: "jpeg",
      width: 5000,
      height: 5000,
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

  test("refuses a decompression bomb from the header alone (> 25 MP)", () => {
    expect(MAX_IMAGE_PIXELS).toBe(25_000_000);
    // 5001 x 5000 is just over the budget; the file itself is a few dozen bytes.
    for (const bomb of [
      pngHeader(5001, 5000),
      jpegHeader(5001, 5000),
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
