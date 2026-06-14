// packages/backend/convex/catalog/adapters/htmlFallback.ts
// Heuristic raw-HTML fallback for store pages that render product data with NO structured metadata
// (no JSON-LD, no OpenGraph, sometimes not even a useful <title>) — e.g. kleertjes.com. Pure DOM
// scraping with cheerio. Never throws: returns { images: [] } on any parse failure.
import type { RawProductPage } from "@jigswap/domain";
import * as cheerio from "cheerio";

export interface HtmlFallbackResult {
  readonly images: string[];
  readonly title?: string;
  readonly description?: string;
}

const collapseWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

// Splits "<product> | <site>" / "<product> - <site>" and keeps the leading (product) segment when
// the title carries a site-name suffix. Conservative: only strips the LAST separator group.
const stripSiteSuffix = (title: string): string => {
  const match = title.match(/^(.*\S)\s+[|\-–·]\s+\S.*$/);
  if (match) {
    const head = match[1].trim();
    if (head.length > 0) return head;
  }
  return title;
};

// Junk patterns: anything that smells like chrome/payment/iconography rather than a product photo.
const JUNK_RE =
  /logo|icon|sprite|placeholder|avatar|flag|payment|badge|thumb(?:nail)?-?\d{0,2}x|1x1|pixel/i;
const PRODUCT_HINT_RE = /product|cover|main|hero|gallery|detail/i;

// Pick the largest-resolution candidate from a srcset string (`url 800w, url2 1600w` or `url 2x`).
const largestFromSrcset = (srcset: string): string | undefined => {
  let best: string | undefined;
  let bestScore = -1;
  for (const entry of srcset.split(",")) {
    const parts = entry.trim().split(/\s+/);
    const url = parts[0];
    if (!url) continue;
    const descriptor = parts[1] ?? "";
    const widthMatch = descriptor.match(/^(\d+)w$/);
    const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/);
    const score = widthMatch
      ? Number(widthMatch[1])
      : densityMatch
        ? Number(densityMatch[1])
        : 0;
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
};

interface Candidate {
  url: string;
  score: number;
}

const resolveUrl = (raw: string, sourceUrl: string): string | undefined => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(trimmed, sourceUrl);
  } catch {
    return undefined;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return undefined;
  }
  if (/\.svg(?:$|[?#])/i.test(resolved.pathname)) return undefined;
  return resolved.toString();
};

export const scrapeHtmlFallback = (
  html: string,
  sourceUrl: string,
): HtmlFallbackResult => {
  try {
    const $ = cheerio.load(html);

    // --- Title ---
    let title: string | undefined;
    $("h1").each((_, el) => {
      if (title) return;
      const text = collapseWhitespace($(el).text());
      if (text) title = text;
    });
    if (!title) {
      const docTitle = collapseWhitespace($("title").first().text());
      if (docTitle) title = collapseWhitespace(stripSiteSuffix(docTitle));
    }
    if (!title) {
      const metaTitle = $('meta[name="title"]').attr("content");
      if (metaTitle) {
        const cleaned = collapseWhitespace(metaTitle);
        if (cleaned) title = cleaned;
      }
    }

    // --- Description ---
    let description: string | undefined;
    const metaDesc = $('meta[name="description"]').attr("content");
    if (metaDesc) {
      const cleaned = collapseWhitespace(metaDesc);
      if (cleaned) description = cleaned;
    }

    // --- Images ---
    const candidates: Candidate[] = [];
    const pushCandidate = (rawUrl: string, hintText: string): void => {
      const resolved = resolveUrl(rawUrl, sourceUrl);
      if (!resolved) return;
      if (JUNK_RE.test(resolved) || JUNK_RE.test(hintText)) return;
      candidates.push({ url: resolved, score: 0 });
    };

    $("img").each((_, el) => {
      const $img = $(el);
      const hint = `${$img.attr("class") ?? ""} ${$img.attr("alt") ?? ""} ${$img.attr("id") ?? ""}`;

      const src = $img.attr("src");
      const srcset = $img.attr("srcset");
      const srcsetBest = srcset ? largestFromSrcset(srcset) : undefined;

      const start = candidates.length;
      if (src) pushCandidate(src, hint);
      if (srcsetBest) pushCandidate(srcsetBest, hint);

      // Score the candidates this <img> contributed.
      const width = Number($img.attr("width"));
      const height = Number($img.attr("height"));
      const bigDims =
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width >= 200 &&
        height >= 200;
      const productHint = PRODUCT_HINT_RE.test(hint);
      for (let i = start; i < candidates.length; i++) {
        if (bigDims) candidates[i].score += 2;
        if (productHint) candidates[i].score += 1;
      }
    });

    $("picture source[srcset]").each((_, el) => {
      const srcset = $(el).attr("srcset");
      const best = srcset ? largestFromSrcset(srcset) : undefined;
      if (best) pushCandidate(best, "");
    });

    $('link[rel="image_src"][href]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) pushCandidate(href, "");
    });

    // Stable sort by score desc, dedupe exact urls, cap at 8.
    const ordered = candidates
      .map((c, i) => ({ ...c, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    const seen = new Set<string>();
    const images: string[] = [];
    for (const c of ordered) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      images.push(c.url);
      if (images.length >= 8) break;
    }

    return { images, title, description };
  } catch {
    return { images: [] };
  }
};

// Enrich a RawProductPage with heuristic HTML scraping, but ONLY where structured data left a gap.
// A rich page (already has OG/JSON-LD images and a title) is returned untouched.
export const enrichWithHtmlFallback = (
  page: RawProductPage,
  html: string,
  sourceUrl: string,
): RawProductPage => {
  const needsImages =
    page.ogImages.length === 0 &&
    page.jsonLdProducts.every((p) => p.image == null);
  const needsTitle =
    !page.ogTitle &&
    !page.basicTitle &&
    page.jsonLdProducts.every((p) => !p.name);
  if (!needsImages && !needsTitle) return page;

  const fb = scrapeHtmlFallback(html, sourceUrl);
  return {
    ...page,
    ogImages: needsImages && fb.images.length > 0 ? fb.images : page.ogImages,
    basicTitle: needsTitle && fb.title ? fb.title : page.basicTitle,
    basicDescription: page.basicDescription || fb.description,
  };
};
