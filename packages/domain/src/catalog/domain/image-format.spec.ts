import { describe, expect, it } from "vitest";
import { hasUnsupportedImageExtension } from "./image-format";

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

describe("image-format module", () => {
  it("does not carry a second magic-byte sniffer (the backend guard owns it)", async () => {
    expect(await import("./image-format")).not.toHaveProperty("sniffImageType");
  });
});
