import type { RawProductPage } from "@jigswap/domain";
import { describe, expect, test } from "vitest";
import {
  enrichWithHtmlFallback,
  scrapeHtmlFallback,
} from "./catalog/adapters/htmlFallback";

const FIXTURE = `<html><head><title>Jungletocht 1000 stukjes - kleertjes.com</title><meta name="description" content="Mooie puzzel"></head><body><h1>Jan van Haasteren Jungletocht</h1><img src="/media/p/jungletocht-800.jpg" width="800" height="900" class="product-image"><img src="/static/logo.svg"><img src="https://cdn.example.com/p/extra.jpg"></body></html>`;

const SOURCE_URL = "https://www.kleertjes.com/puzzels/jungletocht";

describe("scrapeHtmlFallback", () => {
  test("extracts title from <h1>, description from meta, product images, dropping logo.svg", () => {
    const result = scrapeHtmlFallback(FIXTURE, SOURCE_URL);

    expect(result.title).toBe("Jan van Haasteren Jungletocht");
    expect(result.description).toBe("Mooie puzzel");
    expect(result.images).toContain(
      "https://www.kleertjes.com/media/p/jungletocht-800.jpg",
    );
    expect(result.images).toContain("https://cdn.example.com/p/extra.jpg");
    expect(result.images.some((u) => u.endsWith("logo.svg"))).toBe(false);
  });

  test("strips site-name suffix from <title> when no <h1> exists", () => {
    const html =
      "<html><head><title>Ravensburger Sterrenhemel | shop.example.com</title></head><body></body></html>";
    const result = scrapeHtmlFallback(html, "https://shop.example.com/p");
    expect(result.title).toBe("Ravensburger Sterrenhemel");
  });

  test("never throws on malformed input", () => {
    expect(() => scrapeHtmlFallback("<<<not-html", SOURCE_URL)).not.toThrow();
  });
});

describe("enrichWithHtmlFallback", () => {
  test("leaves a rich page (ogImages + basicTitle) untouched", () => {
    const rich: RawProductPage = {
      ogTitle: "Real OG Title",
      ogImages: ["https://og.example.com/image.jpg"],
      basicTitle: "Basic Title",
      jsonLdProducts: [],
    };
    const enriched = enrichWithHtmlFallback(rich, FIXTURE, SOURCE_URL);
    expect(enriched.ogImages).toEqual(["https://og.example.com/image.jpg"]);
    expect(enriched.ogTitle).toBe("Real OG Title");
    expect(enriched).toBe(rich); // returned untouched (no gap)
  });

  test("fills images and title when structured data is absent", () => {
    const empty: RawProductPage = {
      ogImages: [],
      jsonLdProducts: [],
    };
    const enriched = enrichWithHtmlFallback(empty, FIXTURE, SOURCE_URL);
    expect(enriched.basicTitle).toBe("Jan van Haasteren Jungletocht");
    expect(enriched.ogImages).toContain(
      "https://www.kleertjes.com/media/p/jungletocht-800.jpg",
    );
    expect(enriched.basicDescription).toBe("Mooie puzzel");
  });
});
