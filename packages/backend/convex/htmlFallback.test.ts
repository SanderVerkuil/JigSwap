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

  test("resolves path-relative images against <base href>, not the page path (jvh-puzzels)", () => {
    // jvh-puzzels serves <base href="https://site/"> and a path-relative `isotope/i/...` src.
    // Resolving against the deep product URL would wrongly produce `/webshop/product/.../isotope/...`.
    const html =
      '<html><head><base href="https://www.jvh-puzzels.nl/">' +
      "<title>Hockey Kampioenschappen</title></head><body>" +
      '<img src="isotope/i/id-1110100816-hockey-kampioenschappen-artwork.jpg" width="1000" height="714" alt="">' +
      "</body></html>";
    const result = scrapeHtmlFallback(
      html,
      "https://www.jvh-puzzels.nl/webshop/product/1000-stukjes/hockey-kampioenschappen-1000-stukjes.html",
    );

    expect(result.images).toContain(
      "https://www.jvh-puzzels.nl/isotope/i/id-1110100816-hockey-kampioenschappen-artwork.jpg",
    );
    expect(result.images.some((u) => u.includes("/webshop/product/"))).toBe(
      false,
    );
  });

  test("captures non-empty alt text keyed by resolved image URL", () => {
    const html =
      "<html><head><title>P</title></head><body>" +
      '<img src="/img/box.jpg" width="800" height="800" alt="Sunset over the bay">' +
      '<img src="/img/back.jpg" width="800" height="800" alt="">' +
      "</body></html>";
    const result = scrapeHtmlFallback(html, "https://shop.example.com/p");

    expect(result.imageAlts).toEqual({
      "https://shop.example.com/img/box.jpg": "Sunset over the bay",
    });
    // The empty-alt image contributes no entry.
    expect(
      result.imageAlts?.["https://shop.example.com/img/back.jpg"],
    ).toBeUndefined();
  });

  test("omits imageAlts entirely when no image has alt text", () => {
    const html =
      "<html><head><title>P</title></head><body>" +
      '<img src="/img/box.jpg" width="800" height="800" alt="">' +
      "</body></html>";
    const result = scrapeHtmlFallback(html, "https://shop.example.com/p");

    expect(result.imageAlts).toBeUndefined();
  });

  test("falls back to the page URL when there is no <base href>", () => {
    const html =
      "<html><head><title>P</title></head><body>" +
      '<img src="img/box.jpg" width="800" height="800">' +
      "</body></html>";
    const result = scrapeHtmlFallback(html, "https://shop.example.com/p/123");

    expect(result.images).toContain("https://shop.example.com/p/img/box.jpg");
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

  test("propagates scraped alt text onto the page when adopting scraped images", () => {
    const empty: RawProductPage = { ogImages: [], jsonLdProducts: [] };
    const html =
      "<html><head><title>P</title></head><body>" +
      '<img src="/img/box.jpg" width="800" height="800" alt="The box front">' +
      "</body></html>";
    const enriched = enrichWithHtmlFallback(
      empty,
      html,
      "https://shop.example.com/p",
    );
    expect(enriched.imageAlts).toEqual({
      "https://shop.example.com/img/box.jpg": "The box front",
    });
  });
});
