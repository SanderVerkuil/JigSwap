"use node";

import {
  err,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extractFromHtml } from "ogie";
import type { Response } from "undici";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";
import { fetchPublic, readBodyCapped } from "./publicFetch";

// ogie's own fetch limits, kept so this tier fails where ogie's extract() did.
const TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const isHtmlContentType = (contentType: string) => {
  const type = contentType.toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml+xml");
};

// Why a fetched response is not a page to parse, as the ogie error (code and message) extract()
// raised for it, or null when it is one. mapOgieError turns it into the domain error.
const unusableResponse = (
  response: Response,
): { code: string; message: string } | null => {
  if (response.status >= 300 && response.status < 400) {
    return response.headers.get("location") === null
      ? {
          code: "FETCH_ERROR",
          message: "Redirect response without valid Location header",
        }
      : {
          code: "REDIRECT_LIMIT",
          message: `HTTP ${response.status}: redirects are not followed`,
        };
  }
  if (!response.ok) {
    return {
      code: "FETCH_ERROR",
      message: `HTTP ${response.status}: ${response.statusText}`,
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!isHtmlContentType(contentType)) {
    return {
      code: "FETCH_ERROR",
      message: `Expected HTML content, received: ${contentType}`,
    };
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return {
      code: "FETCH_ERROR",
      message: `Response size ${declaredLength} bytes exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes`,
    };
  }
  return null;
};

// The primary page tier: one GET of the entry URL, parsed with ogie.
// SSRF: the fetch goes through catalog/adapters/publicFetch, which checks the address inside the
// connection's own DNS lookup, so neither a private host nor a DNS rebind can be reached. This
// tier does NOT follow redirects (maxRedirects 0): a redirecting store URL surfaces as a
// retryable FetchFailed ("Too many redirects", as ogie's REDIRECT_LIMIT did) and falls through to
// browserStorePageFetcher, the only page tier that follows redirects.
export const ogieStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    let html: string;
    try {
      const outcome = await fetchPublic(url, {
        headers: {
          "User-Agent": "JigSwapBot/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        // One deadline across the request and the body read.
        signal: AbortSignal.timeout(TIMEOUT_MS),
        maxRedirects: 0,
      });
      if (!outcome.ok) {
        return err(
          outcome.code === "Blocked"
            ? StorePageFetchError.blocked(url, outcome.detail)
            : StorePageFetchError.invalidUrl(url, outcome.detail),
        );
      }
      const unusable = unusableResponse(outcome.response);
      if (unusable !== null) {
        await outcome.response.body?.cancel();
        return err(mapOgieError(unusable, url));
      }
      // Read at most 10 MB, cancelling the stream there instead of buffering the rest.
      const { bytes, truncated } = await readBodyCapped(
        outcome.response,
        MAX_BODY_BYTES,
      );
      if (truncated) {
        return err(
          mapOgieError(
            {
              code: "FETCH_ERROR",
              message: `Response size exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes`,
            },
            url,
          ),
        );
      }
      html = new TextDecoder().decode(bytes);
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError")
      ) {
        return err(
          mapOgieError(
            {
              code: "TIMEOUT",
              message: `Request timeout after ${TIMEOUT_MS}ms`,
            },
            url,
          ),
        );
      }
      // undici reports a network failure as "fetch failed", with the reason as its cause.
      const message = e instanceof Error ? e.message : String(e);
      const cause =
        e instanceof Error && "cause" in e && e.cause instanceof Error
          ? `: ${e.cause.message}`
          : "";
      return err(
        mapOgieError({ code: "FETCH_ERROR", message: message + cause }, url),
      );
    }

    // baseUrl resolves relative og:image and link URLs against the page, as extract() did.
    const result = extractFromHtml(html, { baseUrl: url });
    if (!result.success) {
      return err(mapOgieError(result.error, url));
    }

    return ok({ ...toRawProductPage(result.data), source: "ogie" });
  },
};
