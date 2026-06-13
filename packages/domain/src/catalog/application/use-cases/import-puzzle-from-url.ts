import { Clock, err, ok } from "../../../shared-kernel";
import {
  extractPuzzleDraft,
  normalizeStoreUrl,
  PuzzleImportDraft,
  StorePageFetchError,
} from "../../domain";
import { ImportPuzzleFromUrl } from "../ports/in/import-puzzle-from-url.port";
import { ImportDraftCache } from "../ports/out/import-draft-cache";
import { PuzzleMatchLookup } from "../ports/out/puzzle-match-lookup";
import { StorePageFetcher } from "../ports/out/store-page-fetcher";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ImportPuzzleFromUrlDeps {
  readonly fetcher: StorePageFetcher;
  readonly cache: ImportDraftCache;
  readonly lookup: PuzzleMatchLookup;
  readonly clock: Clock;
  readonly cacheTtlMs?: number;
}

// Read-only orchestration: normalize -> cache (fresh?) or fetch+extract+cache -> dedup lookup.
// Persists nothing about the puzzle itself; the user reviews the draft before any creation.
export const makeImportPuzzleFromUrl =
  (deps: ImportPuzzleFromUrlDeps): ImportPuzzleFromUrl =>
  async (cmd) => {
    let normalized: string;
    try {
      normalized = normalizeStoreUrl(cmd.url);
    } catch {
      return err(StorePageFetchError.invalidUrl(cmd.url));
    }

    const ttl = deps.cacheTtlMs ?? DEFAULT_TTL_MS;
    const cached = await deps.cache.get(normalized);

    let draft: PuzzleImportDraft;
    let servedFromCache = false;
    let diagnostics: {
      source: string;
      jsonLdProducts: number;
      ogImages: number;
      images: number;
    };

    if (
      cached &&
      deps.clock.now().getTime() - cached.fetchedAt.getTime() < ttl
    ) {
      draft = cached.draft;
      servedFromCache = true;
      diagnostics = {
        source: "cache",
        jsonLdProducts: 0,
        ogImages: 0,
        images: draft.images.length,
      };
    } else {
      const fetched = await deps.fetcher.fetch(cmd.url);
      if (fetched.isErr) return err(fetched.error);
      const raw = fetched.value;
      draft = extractPuzzleDraft(raw, cmd.url);
      diagnostics = {
        source: raw.source ?? "unknown",
        jsonLdProducts: raw.jsonLdProducts.length,
        ogImages: raw.ogImages.length,
        images: draft.images.length,
      };
      // Only cache a useful extraction. Caching an empty draft (no title and no images) would pin a
      // failure for the full TTL and mask a later fix (e.g. a new fallback tier), so let empties
      // re-fetch next time instead.
      if (draft.title.trim().length > 0 || draft.images.length > 0) {
        await deps.cache.put(normalized, draft);
      }
    }

    const match =
      draft.ean || draft.upc
        ? await deps.lookup.findByBarcode({ ean: draft.ean, upc: draft.upc })
        : null;
    return ok({ draft, match, cached: servedFromCache, diagnostics });
  };
