"use node";
import {
  type CachedImportDraft,
  type ImportDraftCache,
  makeFallbackStorePageFetcher,
  makeImportPuzzleFromUrl,
  type PuzzleMatchLookup,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { browserStorePageFetcher } from "./adapters/browserStorePageFetcher";
import { firecrawlStorePageFetcher } from "./adapters/firecrawlStorePageFetcher";
import { ogieStorePageFetcher } from "./adapters/ogieStorePageFetcher";
import { systemClock } from "./adapters/systemClock";

// Public Node action: the driving adapter. Wires ogie (page fetch) + ctx-backed cache/lookup
// ports into the import use case. Returns a discriminated result so the UI degrades gracefully
// (ok:false -> manual entry) and never sees a thrown error for a bad page.
//
// Emits ONE wide event per call (logging-best-practices) so a failed extraction is diagnosable:
// the event carries the url, the caller, the outcome, the error code AND the underlying ogie
// `detail`, plus cache-hit / match / draft-shape facts and the duration.
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
    const flush = () => {
      event.duration_ms = Date.now() - startedAt;
      logEvent(event);
    };

    const identity = await ctx.auth.getUserIdentity();
    event.user_subject = identity?.subject ?? null;
    if (identity === null) {
      event.outcome = "error";
      event.error = { code: "Unauthenticated" };
      flush();
      throw new ConvexError("Unauthenticated");
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
                draft: row.draft,
                fetchedAt: new Date(row.fetchedAt),
              } satisfies CachedImportDraft)
            : null;
        },
        async put(normalizedUrl, draft) {
          await ctx.runMutation(internal.catalog.importCache.putCachedImport, {
            normalizedUrl,
            draft,
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

      const importDraft = makeImportPuzzleFromUrl({
        fetcher: makeFallbackStorePageFetcher(
          ogieStorePageFetcher,
          makeFallbackStorePageFetcher(
            browserStorePageFetcher,
            firecrawlStorePageFetcher,
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

      const { draft, match, cached } = result.value;
      event.cache_hit = cached;
      event.match_found = match !== null;
      event.match_puzzle_id = match?.puzzleId ?? null;
      event.draft = {
        has_title: draft.title.length > 0,
        title: draft.title.slice(0, 120),
        brand: draft.brand ?? null,
        piece_count: draft.pieceCount ?? null,
        has_image: Boolean(draft.imageUrl),
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
      flush();
    }
  },
});
