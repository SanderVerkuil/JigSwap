// packages/backend/convex/catalog/adapters/firecrawlStorePageFetcher.ts
import {
  err,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extractFromHtml } from "ogie";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";

// Firecrawl API: POST /v1/scrape
// Request body: { url, formats: ["html"], onlyMainContent: false }
// Response: { success: boolean, data: { html: string, ... }, error?: string }
export const firecrawlStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return err(
        StorePageFetchError.fetchFailed(
          "firecrawl not configured",
          "FIRECRAWL_API_KEY missing",
        ),
      );
    }

    let res: Response;
    try {
      res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["html"],
          onlyMainContent: false,
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(StorePageFetchError.fetchFailed(message, detail));
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return err(
        StorePageFetchError.fetchFailed(`firecrawl HTTP ${res.status}`, body),
      );
    }

    let json: { success?: boolean; data?: { html?: unknown }; error?: string };
    try {
      json = await res.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(
        StorePageFetchError.unparseable(
          url,
          `firecrawl JSON parse: ${message}`,
        ),
      );
    }

    if (!json.success || typeof json?.data?.html !== "string") {
      return err(
        StorePageFetchError.unparseable(
          url,
          `firecrawl: ${json?.error ?? "no html"}`,
        ),
      );
    }

    let result: ReturnType<typeof extractFromHtml>;
    try {
      result = extractFromHtml(json.data.html);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(
        StorePageFetchError.fetchFailed(
          `firecrawl parse threw: ${message}`,
          detail,
        ),
      );
    }

    if (!result.success) {
      return err(mapOgieError(result.error, url));
    }

    return ok(toRawProductPage(result.data));
  },
};
