"use node";
import {
  err,
  isPrivateIp,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { lookup as dnsLookup } from "node:dns/promises";
import { extractFromHtml } from "ogie";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB cap to avoid reading huge pages
const MAX_REDIRECTS = 5;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Reject any hostname that resolves to a private/loopback/link-local address (SSRF guard).
// Mirrors importPuzzleImage.ts assertPublicHost — must be kept in sync.
const assertPublicHost = async (
  hostname: string,
  url: string,
): Promise<StorePageFetchError | null> => {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return StorePageFetchError.fetchFailed(`DNS lookup failed: ${msg}`, msg);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    return StorePageFetchError.blocked(
      url,
      `Refused to fetch (blocked address): ${hostname}`,
    );
  }
  return null;
};

export const browserStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    // Validate initial URL and protocol
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return err(StorePageFetchError.invalidUrl(url, "URL parse error"));
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return err(
        StorePageFetchError.invalidUrl(
          url,
          `Unsupported protocol: ${parsed.protocol}`,
        ),
      );
    }

    // Shared deadline across all hops (same pattern as importPuzzleImage)
    const signal = AbortSignal.timeout(10000);
    let currentUrl = url;
    let response: Response | null = null;

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let hopParsed: URL;
        try {
          hopParsed = new URL(currentUrl);
        } catch {
          return err(
            StorePageFetchError.invalidUrl(
              currentUrl,
              "Redirect URL parse error",
            ),
          );
        }
        if (hopParsed.protocol !== "http:" && hopParsed.protocol !== "https:") {
          return err(
            StorePageFetchError.invalidUrl(
              currentUrl,
              `Unsupported redirect protocol: ${hopParsed.protocol}`,
            ),
          );
        }

        // SSRF guard: DNS-resolve and reject private IPs (re-run on each hop)
        const blocked = await assertPublicHost(hopParsed.hostname, currentUrl);
        if (blocked !== null) return err(blocked);

        const res = await fetch(currentUrl, {
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
          },
          signal,
          redirect: "manual", // NEVER redirect:follow — must re-validate each hop
        });

        if (res.status >= 300 && res.status < 400) {
          if (hop === MAX_REDIRECTS) {
            return err(
              StorePageFetchError.fetchFailed(
                "Too many redirects",
                `Exceeded ${MAX_REDIRECTS} redirects from ${url}`,
              ),
            );
          }
          const location = res.headers.get("location");
          if (!location) {
            return err(
              StorePageFetchError.fetchFailed(
                "Redirect without location header",
                `HTTP ${res.status} with no Location from ${currentUrl}`,
              ),
            );
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        response = res;
        break;
      }
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

    if (response === null) {
      // Shouldn't happen given the redirect limit above, but be explicit
      return err(
        StorePageFetchError.fetchFailed(
          "Too many redirects",
          `Exceeded ${MAX_REDIRECTS} redirects from ${url}`,
        ),
      );
    }

    if (!response.ok) {
      return err(
        StorePageFetchError.fetchFailed(
          `browser-retry HTTP ${response.status}`,
          `browser-retry HTTP ${response.status} from ${currentUrl}`,
        ),
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return err(
        StorePageFetchError.unparseable(
          url,
          `browser-retry non-html: ${contentType}`,
        ),
      );
    }

    // Cap body read to avoid huge pages; still attempt parse on truncated content
    // (metadata lives in <head>, which is typically well within the first 5 MB).
    const buffer = await response.arrayBuffer();
    const html = new TextDecoder().decode(
      buffer.byteLength > MAX_BODY_BYTES
        ? buffer.slice(0, MAX_BODY_BYTES)
        : buffer,
    );

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

    return ok({ ...toRawProductPage(ogieResult.data), source: "browser-ua" });
  },
};
