import { ok } from "../../shared-kernel";
import {
  type RawProductPage,
  type StorePageFetchError,
  type StorePageFetchErrorCode,
} from "../domain";
import { type StorePageFetcher } from "./ports/out/store-page-fetcher";

// Error codes worth retrying with a different fetch strategy (blocked/garbled/missing pages).
// Not retried: InvalidUrl (won't change), Timeout (already slow — don't double the wait).
const RETRYABLE: ReadonlyArray<StorePageFetchErrorCode> = [
  "Blocked",
  "NotFound",
  "FetchFailed",
  "Unparseable",
];

// Every image URL a fetched page surfaced: each JSON-LD product's image(s) plus the OpenGraph
// images. Used to decide whether a page is "image-complete" and to merge a later tier's images in.
const imagesOf = (page: RawProductPage): string[] => {
  const out: string[] = [];
  for (const product of page.jsonLdProducts) {
    if (typeof product.image === "string") out.push(product.image);
    else if (Array.isArray(product.image)) out.push(...product.image);
  }
  out.push(...page.ogImages);
  return out;
};

// True when the page surfaced at least one (non-empty) image candidate. A page with a title but NO
// image is common when a tier reads only structured data — a later tier that scrapes the raw HTML
// may still find the image, so it's worth trying the fallback even on an otherwise-OK page.
const hasImages = (page: RawProductPage): boolean =>
  imagesOf(page).some((url) => url.length > 0);

// Gap-filling merge: keep the primary's fields where present, fill a missing title/description from
// the fallback, and ADD the fallback's images to the primary's OpenGraph images. Lets a tier that
// found the title but no image be completed by a later tier that found the image, without losing the
// primary's data. (The primary's JSON-LD products are preserved, so their own images stay attached.)
const mergePages = (
  primary: RawProductPage,
  fallback: RawProductPage,
): RawProductPage => {
  // Union the per-URL alt maps; the primary wins on a key conflict. Undefined (not {}) when neither
  // tier scraped alt text, keeping the merged page minimal.
  const mergedAlts = { ...fallback.imageAlts, ...primary.imageAlts };
  return {
    ogTitle: primary.ogTitle ?? fallback.ogTitle,
    ogDescription: primary.ogDescription ?? fallback.ogDescription,
    basicTitle: primary.basicTitle ?? fallback.basicTitle,
    basicDescription: primary.basicDescription ?? fallback.basicDescription,
    ogImages: [...primary.ogImages, ...imagesOf(fallback)],
    imageAlts: Object.keys(mergedAlts).length > 0 ? mergedAlts : undefined,
    jsonLdProducts:
      primary.jsonLdProducts.length > 0
        ? primary.jsonLdProducts
        : fallback.jsonLdProducts,
    source:
      primary.source != null && fallback.source != null
        ? `${primary.source}+${fallback.source}`
        : (primary.source ?? fallback.source),
  };
};

// Tries `primary`; if it fails with a retryable error, tries `fallback`. Additionally, when the
// primary SUCCEEDS but the page carries no image, it tries the fallback too and merges any images it
// finds into the primary's result (a tier may read the title from structured data yet miss an image
// only present in the raw HTML). Returns the merged page on success, else the primary's result.
export const makeFallbackStorePageFetcher = (
  primary: StorePageFetcher,
  fallback: StorePageFetcher,
  shouldFallback: (e: StorePageFetchError) => boolean = (e) =>
    RETRYABLE.includes(e.code),
): StorePageFetcher => ({
  async fetch(url) {
    const first = await primary.fetch(url);
    if (first.isErr) {
      return shouldFallback(first.error) ? fallback.fetch(url) : first;
    }
    // OK and already has an image: nothing more to gain from another fetch.
    if (hasImages(first.value)) return first;
    // OK but image-less: a different tier might surface the image — merge it in if so.
    const second = await fallback.fetch(url);
    return second.isOk ? ok(mergePages(first.value, second.value)) : first;
  },
});
