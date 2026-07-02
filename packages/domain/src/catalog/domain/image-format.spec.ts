import { describe, expect, it } from "vitest";
import { hasUnsupportedImageExtension, sniffImageType } from "./image-format";

describe("hasUnsupportedImageExtension", () => {
  it("rejects extensions the import action can never accept", () => {
    expect(hasUnsupportedImageExtension("https://a.b/logo.svg")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/x.SVG")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/scan.tiff")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/scan.tif")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/fav.ico")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/img.bmp")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/shot.heic")).toBe(true);
    expect(hasUnsupportedImageExtension("https://a.b/doc.pdf")).toBe(true);
  });

  it("keeps supported and unknown/extension-less URLs (the action stays authoritative)", () => {
    expect(hasUnsupportedImageExtension("https://a.b/box.jpg")).toBe(false);
    expect(hasUnsupportedImageExtension("https://a.b/box.jpeg")).toBe(false);
    expect(hasUnsupportedImageExtension("https://a.b/box.png")).toBe(false);
    expect(hasUnsupportedImageExtension("https://a.b/box.webp")).toBe(false);
    expect(hasUnsupportedImageExtension("https://a.b/box.avif")).toBe(false);
    expect(hasUnsupportedImageExtension("https://a.b/box.gif")).toBe(false);
    expect(hasUnsupportedImageExtension("https://cdn.a.b/i/12345")).toBe(false);
    expect(
      hasUnsupportedImageExtension("https://a.b/img?fmt=svg"), // query only — path has no extension
    ).toBe(false);
  });

  it("reads the extension from the pathname, ignoring query and fragment", () => {
    expect(hasUnsupportedImageExtension("https://a.b/logo.svg?v=2#top")).toBe(
      true,
    );
    expect(hasUnsupportedImageExtension("https://a.b/box.jpg?width=800")).toBe(
      false,
    );
  });

  it("treats unparseable URLs as not-unsupported (later guards own them)", () => {
    expect(hasUnsupportedImageExtension("not a url")).toBe(false);
  });
});

describe("sniffImageType", () => {
  const bytes = (...values: (number | string)[]): Uint8Array => {
    const out: number[] = [];
    for (const v of values) {
      if (typeof v === "string")
        out.push(...[...v].map((c) => c.charCodeAt(0)));
      else out.push(v);
    }
    return new Uint8Array(out);
  };

  it("identifies the supported raster formats by magic bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png",
    );
    expect(sniffImageType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe(
      "image/webp",
    );
    // Real-world regression: ravensburger.cloud serves valid WebP with NO
    // content-type + nosniff (first 16 observed bytes: RIFF: ..WEBPVP8 ).
    expect(
      sniffImageType(bytes("RIFF", 0x3a, 0x20, 0x02, 0x00, "WEBPVP8 ")),
    ).toBe("image/webp");
    expect(sniffImageType(bytes(0, 0, 0, 0x20, "ftypavif", 0, 0, 0, 0))).toBe(
      "image/avif",
    );
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, "ftypavis", 0, 0, 0, 0))).toBe(
      "image/avif",
    );
  });

  it("returns null for anything else — including SVG/HTML lookalikes", () => {
    expect(sniffImageType(bytes("<svg xmlns"))).toBeNull();
    expect(sniffImageType(bytes("<!DOCTYPE html>"))).toBeNull();
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull(); // RIFF but not WebP
    expect(sniffImageType(bytes(0, 0, 0, 0x18, "ftypmp42"))).toBeNull(); // ISO-BMFF but not AVIF
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes(0x00, 0x01, 0x02))).toBeNull();
  });
});
