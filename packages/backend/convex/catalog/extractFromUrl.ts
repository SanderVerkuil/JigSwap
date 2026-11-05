"use node";

import {
  err,
  makeFallbackStorePageFetcher,
  makeImportPuzzleFromUrl,
  StorePageFetchError,
  type CachedImportDraft,
  type ImportDraftCache,
  type PuzzleMatchLookup,
  type StorePageFetcher,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { assertPublicUrl } from "./adapters/assertPublicUrl";
import { browserStorePageFetcher } from "./adapters/browserStorePageFetcher";
import { firecrawlStorePageFetcher } from "./adapters/firecrawlStorePageFetcher";
import { ogieStorePageFetcher } from "./adapters/ogieStorePageFetcher";
import { systemClock } from "./adapters/systemClock";

// The gate's refusal code for the wide event: requireMember throws a bare message, the rate
// limit a { code } object.
const refusalCode = (error: unknown): string => {
  const data: unknown = error instanceof ConvexError ? error.data : undefined;
  if (typeof data === "string") return data;
  if (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    typeof data.code === "string"
  ) {
    return data.code;
  }
  return "Unexpected";
};

// Public Node action: the driving adapter. Wires ogie (page fetch) + ctx-backed cache/lookup
// ports into the import use case. Returns a discriminated result so the UI degrades gracefully
// (ok:false -> manual entry) and never sees a thrown error for a bad page.
//
// Emits ONE wide event per call (logging-best-practices) so a failed extraction is diagnosable:
// the event carries the url, the caller, the outcome, the error code AND the underlying ogie
// `detail`, plus cache-hit / match / draft-shape facts and the duration.
//
// The one thrown refusal is the gate (urlImportGate.beginUrlImport): no member, or the
// member's import buckets are full (ConvexError { code: "RateLimited", retryAfterMs }).
export const extractFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: "catalog.extractFromUrl",
      outcome: "success",
      request_id: crypto.randomUUID(),
      url,
    };
    // Emit to Convex logs (console) and forward to Axiom (no-op unless AXIOM_API_KEY is set).
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      const line = logEvent(event);
      await ingestToAxiom(line);
    };

    const identity = await ctx.auth.getUserIdentity();
    event.user_subject = identity?.subject ?? null;
    // Only an active member within their hourly and daily import buckets (admins exempt) may
    // start an import, and a refusal comes before any fetch (catalog/urlImportGate, SEC-21).
    try {
      await ctx.runMutation(internal.catalog.urlImportGate.beginUrlImport, {});
    } catch (error) {
      event.outcome = "error";
      event.error = { code: refusalCode(error) };
      await flush();
      throw error;
    }

    // SSRF pre-flight: enforce http(s) + a public DNS host on the ENTRY url ONCE, before any tier
    // fetches. ogie (lexical-only) and firecrawl (forwards the raw url) thus never see a private
    // host; browserStorePageFetcher still re-validates each redirect hop.
    const publicCheck = await assertPublicUrl(url);
    if (!publicCheck.ok) {
      event.outcome = "error";
      event.error = { code: publicCheck.code, detail: publicCheck.reason };
      await flush();
      return { ok: false as const, code: publicCheck.code };
    }

    try {
      const cache: ImportDraftCache = {
        async get(normalizedUrl) {
          const row = await ctx.runQuery(
            internal.catalog.importCache.getCachedImport,
            { normalizedUrl },
          );
          return row
            ? ({
                draft: { ...row.draft, images: row.draft.images ?? [] },
                fetchedAt: new Date(row.fetchedAt),
              } satisfies CachedImportDraft)
            : null;
        },
        async put(normalizedUrl, draft) {
          await ctx.runMutation(internal.catalog.importCache.putCachedImport, {
            normalizedUrl,
            draft: { ...draft, images: [...draft.images] },
          });
        },
      };

      const lookup: PuzzleMatchLookup = {
        async findByBarcode({ ean, upc }) {
          return ctx.runQuery(
            internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode,
            { ean, upc },
          );
        },
      };

      // Firecrawl is the paid last tier: each scrape is charged to the deployment-wide budget
      // first (lib/rateLimits firecrawlBudget). Once it is spent the tier fails, so the import
      // keeps what a cheaper tier found, or the member fills the details in by hand.
      const budgetedFirecrawl: StorePageFetcher = {
        async fetch(pageUrl) {
          if (process.env.FIRECRAWL_API_KEY) {
            const charged = await ctx.runMutation(
              internal.catalog.urlImportGate.chargeFirecrawl,
              {},
            );
            if (!charged) {
              event.firecrawl_budget_spent = true;
              return err(
                StorePageFetchError.fetchFailed(
                  "firecrawl budget spent",
                  "firecrawl_budget",
                ),
              );
            }
          }
          return firecrawlStorePageFetcher.fetch(pageUrl);
        },
      };

      const importDraft = makeImportPuzzleFromUrl({
        fetcher: makeFallbackStorePageFetcher(
          ogieStorePageFetcher,
          makeFallbackStorePageFetcher(
            browserStorePageFetcher,
            budgetedFirecrawl,
          ),
        ),
        cache,
        lookup,
        clock: systemClock,
      });

      const result = await importDraft({ url });
      if (result.isErr) {
        event.outcome = "error";
        event.error = {
          code: result.error.code,
          detail: result.error.detail ?? null,
        };
        return { ok: false as const, code: result.error.code };
      }

      const { draft, match, cached, diagnostics } = result.value;
      event.cache_hit = cached;
      event.match_found = match !== null;
      event.match_puzzle_id = match?.puzzleId ?? null;
      event.extraction = diagnostics;
      event.draft = {
        has_title: draft.title.length > 0,
        title: draft.title.slice(0, 120),
        brand: draft.brand ?? null,
        piece_count: draft.pieceCount ?? null,
        has_image: Boolean(draft.imageUrl),
        image_count: draft.images.length,
        image_url: draft.imageUrl ?? null,
        description_len: draft.description?.length ?? 0,
        has_ean: Boolean(draft.ean),
        has_upc: Boolean(draft.upc),
      };
      return { ok: true as const, draft, match };
    } catch (error) {
      // Infrastructure failure (e.g. a runQuery/runMutation throwing). Degrade gracefully but
      // capture the full cause in the wide event so it isn't silently swallowed.
      event.outcome = "error";
      event.error = {
        code: "Unexpected",
        detail:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      };
      return { ok: false as const, code: "FetchFailed" as const };
    } finally {
      await flush();
    }
  },
});
