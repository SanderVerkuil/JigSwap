"use node";
import {
  type CachedImportDraft,
  type ImportDraftCache,
  makeImportPuzzleFromUrl,
  type PuzzleMatchLookup,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { ogieStorePageFetcher } from "./adapters/ogieStorePageFetcher";
import { systemClock } from "./adapters/systemClock";

// Public Node action: the driving adapter. Wires ogie (page fetch) + ctx-backed cache/lookup
// ports into the import use case. Returns a discriminated result so the UI degrades gracefully
// (ok:false -> manual entry) and never sees a thrown error for a bad page.
export const extractFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new ConvexError("Unauthenticated");
    }

    try {
      const cache: ImportDraftCache = {
        async get(normalizedUrl) {
          const row = await ctx.runQuery(internal.catalog.importCache.getCachedImport, {
            normalizedUrl,
          });
          return row
            ? ({ draft: row.draft, fetchedAt: new Date(row.fetchedAt) } satisfies CachedImportDraft)
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
          return ctx.runQuery(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
            ean,
            upc,
          });
        },
      };

      const importDraft = makeImportPuzzleFromUrl({
        fetcher: ogieStorePageFetcher,
        cache,
        lookup,
        clock: systemClock,
      });

      const result = await importDraft({ url });
      if (result.isErr) return { ok: false as const, code: result.error.code };
      return { ok: true as const, draft: result.value.draft, match: result.value.match };
    } catch (error) {
      console.error("extractFromUrl failed:", error);
      return { ok: false as const, code: "FetchFailed" as const };
    }
  },
});
