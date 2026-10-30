"use node";

import {
  err,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extractFromHtml } from "ogie";
import type { Response } from "undici";
import { enrichWithHtmlFallback } from "./htmlFallback";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";
import { fetchPublic, readBodyCapped } from "./publicFetch";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap to avoid reading huge pages
const MAX_REDIRECTS = 5;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Why a fetched response cannot be parsed as the product page, or null when it can.
const unusableResponse = (
  response: Response,
  url: string,
  finalUrl: string,
): StorePageFetchError | null => {
  // fetchPublic hands back a redirect only past MAX_REDIRECTS, or when it has no Location.
  if (response.status >= 300 && response.status < 400) {
    return response.headers.get("location") === null
      ? StorePageFetchError.fetchFailed(
          "Redirect without location header",
          `HTTP ${response.status} with no Location from ${finalUrl}`,
        )
      : StorePageFetchError.fetchFailed(
          "Too many redirects",
          `Exceeded ${MAX_REDIRECTS} redirects from ${url}`,
        );
  }
  if (!response.ok) {
    return StorePageFetchError.fetchFailed(
      `browser-retry HTTP ${response.status}`,
      `browser-retry HTTP ${response.status} from ${finalUrl}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return StorePageFetchError.unparseable(
      url,
      `browser-retry non-html: ${contentType}`,
    );
  }
  return null;
};

// The only page tier that follows redirects. SSRF: fetchPublic checks the address inside the
// connection's own DNS lookup, on every hop (catalog/adapters/publicFetch).
export const browserStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    let html: string;
    try {
      const outcome = await fetchPublic(url, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
        },
        // Shared deadline across all hops and the body read (same as importPuzzleImage)
        signal: AbortSignal.timeout(10000),
        maxRedirects: MAX_REDIRECTS,
      });
      if (!outcome.ok) {
        return err(
          outcome.code === "Blocked"
            ? StorePageFetchError.blocked(url, outcome.detail)
            : StorePageFetchError.invalidUrl(url, outcome.detail),
        );
      }
      const unusable = unusableResponse(
        outcome.response,
        url,
        outcome.finalUrl,
      );
      if (unusable !== null) {
        await outcome.response.body?.cancel();
        return err(unusable);
      }
      // Cap body read to avoid huge pages; still attempt parse on truncated content
      // (metadata lives in <head>, which is typically well within the first 5 MB).
      const { bytes } = await readBodyCapped(outcome.response, MAX_BODY_BYTES);
      html = new TextDecoder().decode(bytes);
    } catch (e) {
      // Catches AbortSignal timeout, network errors, etc.
      if (e instanceof Error && e.name === "TimeoutError") {
        return err(
          StorePageFetchError.timeout(url, `browser-retry: ${e.message}`),
        );
      }
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(
        StorePageFetchError.fetchFailed(`browser-retry: ${message}`, detail),
      );
    }

    let ogieResult: ReturnType<typeof extractFromHtml>;
    try {
      ogieResult = extractFromHtml(html);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(
        StorePageFetchError.fetchFailed(
          `browser-retry parse threw: ${message}`,
          detail,
        ),
      );
    }

    if (!ogieResult.success) {
      return err(
        mapOgieError(
          {
            code: ogieResult.error.code,
            message: `browser-retry: ${ogieResult.error.message ?? ogieResult.error.code}`,
          },
          url,
        ),
      );
    }

    return ok({
      ...enrichWithHtmlFallback(toRawProductPage(ogieResult.data), html, url),
      source: "browser-ua",
    });
  },
};
