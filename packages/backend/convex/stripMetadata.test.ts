import { readFileSync } from "node:fs";
import { Jimp } from "jimp";
import { describe, expect, test } from "vitest";
import { readImageDimensions } from "./lib/imageModeration/guards";
import {
  findMetadata,
  orientationOnlyApp1,
  stripImageMetadata,
} from "./lib/imageModeration/stripMetadata";

// Byte-level metadata stripping on real files. The fixtures (test-fixtures/images) were written
// by ImageMagick, exiv2 and Pillow and carry GPS coordinates in every place a camera or editor
// puts them:
// - gps.jpg (64x48): Exif (Make/Model, DateTimeOriginal, UserComment, Orientation 6, a GPS IFD),
//   XMP (exif:GPSLatitude/Longitude, dc:creator), IPTC in APP13 (City, By-line) and a COM.
// - gps.png (40x30, with transparency): eXIf (same Exif incl. GPS), tEXt, zTXt and iTXt (XMP).
// - gps.webp (40x30, VP8X): EXIF (incl. GPS) and "XMP " chunks.

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );

const text = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

// Strings from the fixtures' metadata that must never survive.
const SECRETS = [
  "Kerkstraat",
  "Utrecht",
  "FixtureCam",
  "Fixture Photographer",
  "secret note",
  "52,5.2057N",
  "ns.adobe.com",
  "2026:10:19",
];

const expectNoSecrets = (bytes: Uint8Array) => {
  const content = text(bytes);
  for (const secret of SECRETS) expect(content).not.toContain(secret);
};

const pixelsOf = async (bytes: Uint8Array) => {
  const image = await Jimp.read(Buffer.from(bytes));
  return {
    width: image.bitmap.width,
    height: image.bitmap.height,
    data: Buffer.from(image.bitmap.data),
  };
};

// Insert raw bytes at an offset.
const splice = (bytes: Uint8Array, at: number, insert: Uint8Array) =>
  new Uint8Array([...bytes.subarray(0, at), ...insert, ...bytes.subarray(at)]);

const segment = (marker: number, payload: string | Uint8Array) => {
  const body =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const length = body.length + 2;
  return new Uint8Array([0xff, marker, length >> 8, length & 0xff, ...body]);
};

const plainJpeg = async () =>
  new Uint8Array(
    await new Jimp({ width: 16, height: 8, color: 0x336699ff }).getBuffer(
      "image/jpeg",
    ),
  );

describe("JPEG", () => {
  test("the fixture really carries Exif, XMP, IPTC and a comment with GPS", () => {
    const original = fixture("gps.jpg");
    expect(findMetadata(original, "jpeg")).toEqual([
      "exif",
      "xmp",
      "iptc",
      "comment",
    ]);
    expect(text(original)).toContain("Kerkstraat");
    expect(text(original)).toContain("52,5.2057N");
  });

  test("strips every metadata segment and keeps only the Orientation tag", () => {
    const stripped = stripImageMetadata(fixture("gps.jpg"), "jpeg")!;

    expect(findMetadata(stripped, "jpeg")).toEqual([]);
    expectNoSecrets(stripped);
    // SOI, JFIF APP0, then the 36-byte Orientation-only Exif block (orientation 6).
    expect(text(stripped.subarray(6, 10))).toBe("JFIF");
    expect(stripped.subarray(20, 56)).toEqual(orientationOnlyApp1(6));
    expect(stripped.length).toBeLessThan(fixture("gps.jpg").length - 2900);
  });

  test("the pixels are untouched and decoders still turn the photo upright", async () => {
    const original = fixture("gps.jpg");
    const stripped = stripImageMetadata(original, "jpeg")!;

    // The header is unchanged (64x48 stored sideways); jimp applies Orientation 6 on read.
    expect(readImageDimensions(stripped, "jpeg")).toEqual({
      width: 64,
      height: 48,
    });
    const before = await pixelsOf(original);
    const after = await pixelsOf(stripped);
    expect(after.width).toBe(48);
    expect(after.height).toBe(64);
    expect(after.data.equals(before.data)).toBe(true);
  });

  test("stripping is idempotent (the Orientation block reads back)", () => {
    const once = stripImageMetadata(fixture("gps.jpg"), "jpeg")!;
    expect(stripImageMetadata(once, "jpeg")).toEqual(once);
  });

  test("no Orientation (or Orientation 1) leaves no Exif block at all", async () => {
    const plain = await plainJpeg();
    const withExif = splice(
      plain,
      2,
      segment(0xe1, "Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0"),
    );
    const stripped = stripImageMetadata(withExif, "jpeg")!;
    expect(stripped).toEqual(plain);
  });

  test("drops MPF images, unknown APPn segments and bytes after EOI; keeps ICC and Adobe", async () => {
    const plain = await plainJpeg();
    const icc = segment(0xe2, "ICC_PROFILE\0\x01\x01profile");
    const adobe = segment(0xee, "Adobe\0\x64\0\0\0\0\x01");
    const tampered = new Uint8Array([
      ...splice(
        plain,
        2,
        new Uint8Array([
          ...icc,
          ...segment(0xe2, "MPF\0II*\0 Kerkstraat"),
          ...segment(0xe9, "vendor Utrecht"),
          ...adobe,
        ]),
      ),
      ...new TextEncoder().encode("FixtureCam trailer with GPS"),
    ]);
    expect(findMetadata(tampered, "jpeg")).toEqual(["other", "other", "other"]);

    const stripped = stripImageMetadata(tampered, "jpeg")!;
    expectNoSecrets(stripped);
    expect(stripped).toEqual(
      splice(plain, 2, new Uint8Array([...icc, ...adobe])),
    );
  });

  test("a big-endian Exif block with more than Orientation is reported and reduced", async () => {
    const plain = await plainJpeg();
    // MM TIFF, IFD0 with Orientation 3 and a GPS IFD pointer (tag 0x8825).
    const tiff = new Uint8Array([
      0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 2,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 3, 0, 0,
      0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0,
      0, 0, 0, 0,
    ]); // prettier-ignore
    const exif = segment(
      0xe1,
      new Uint8Array([...new TextEncoder().encode("Exif\0\0"), ...tiff]),
    );
    const withExif = splice(plain, 2, exif);
    expect(findMetadata(withExif, "jpeg")).toEqual(["exif"]);
    expect(stripImageMetadata(withExif, "jpeg")).toEqual(
      splice(plain, 2, orientationOnlyApp1(3)),
    );
  });

  test.each([
    ["truncated inside a segment", (b: Uint8Array) => b.subarray(0, 40)],
    ["without EOI", (b: Uint8Array) => b.subarray(0, b.length - 2)],
    ["not starting with SOI", (b: Uint8Array) => b.subarray(2)],
  ])("a JPEG %s is malformed", (_name, damage) => {
    const damaged = damage(fixture("gps.jpg"));
    expect(stripImageMetadata(damaged, "jpeg")).toBeNull();
    expect(findMetadata(damaged, "jpeg")).toBeNull();
  });
});

describe("PNG", () => {
  test("strips eXIf, tEXt, zTXt and iTXt; the pixels (and transparency) are untouched", async () => {
    const original = fixture("gps.png");
    expect(findMetadata(original, "png")).toEqual([
      "text",
      "text",
      "text",
      "exif",
    ]);
    expect(text(original)).toContain("Kerkstraat");

    const stripped = stripImageMetadata(original, "png")!;

    expect(findMetadata(stripped, "png")).toEqual([]);
    expectNoSecrets(stripped);
    expect(text(stripped)).not.toMatch(/eXIf|tEXt|zTXt|iTXt/);
    const before = await pixelsOf(original);
    const after = await pixelsOf(stripped);
    expect([after.width, after.height]).toEqual([40, 30]);
    expect(after.data.equals(before.data)).toBe(true);
  });

  test("drops bytes after IEND", () => {
    const stripped = stripImageMetadata(fixture("gps.png"), "png")!;
    const trailed = new Uint8Array([
      ...stripped,
      ...new TextEncoder().encode("Kerkstraat"),
    ]);
    expect(findMetadata(trailed, "png")).toEqual(["other"]);
    expect(stripImageMetadata(trailed, "png")).toEqual(stripped);
  });

  test.each([
    ["truncated", (b: Uint8Array) => b.subarray(0, 100)],
    [
      "without IHDR first",
      (b: Uint8Array) =>
        new Uint8Array([...b.subarray(0, 12), 0x58, ...b.subarray(13)]),
    ],
  ])("a PNG %s is malformed", (_name, damage) => {
    expect(stripImageMetadata(damage(fixture("gps.png")), "png")).toBeNull();
  });
});

describe("WebP", () => {
  const chunks = (bytes: Uint8Array) => {
    const out: string[] = [];
    for (let i = 12; i + 8 <= bytes.length;) {
      const size =
        bytes[i + 4] |
        (bytes[i + 5] << 8) |
        (bytes[i + 6] << 16) |
        (bytes[i + 7] << 24);
      out.push(text(bytes.subarray(i, i + 4)));
      i += 8 + size + (size & 1);
    }
    return out;
  };

  test("strips the EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size", () => {
    const original = fixture("gps.webp");
    expect(chunks(original)).toEqual(["VP8X", "VP8 ", "EXIF", "XMP "]);
    expect(findMetadata(original, "webp")).toEqual(["exif", "xmp"]);
    expect(original[20] & 0x0c).toBe(0x0c);

    const stripped = stripImageMetadata(original, "webp")!;

    expect(chunks(stripped)).toEqual(["VP8X", "VP8 "]);
    expect(findMetadata(stripped, "webp")).toEqual([]);
    expectNoSecrets(stripped);
    expect(stripped[20] & 0x0c).toBe(0);
    const riffSize =
      stripped[4] |
      (stripped[5] << 8) |
      (stripped[6] << 16) |
      (stripped[7] << 24);
    expect(riffSize).toBe(stripped.length - 8);
    expect(readImageDimensions(stripped, "webp")).toEqual({
      width: 40,
      height: 30,
    });
    // The image data itself is byte-for-byte the same.
    expect(text(stripped)).toContain(text(original.subarray(30, 30 + 8 + 58)));
  });

  test("a chunk running past the end is malformed", () => {
    expect(
      stripImageMetadata(fixture("gps.webp").subarray(0, 60), "webp"),
    ).toBeNull();
  });
});
