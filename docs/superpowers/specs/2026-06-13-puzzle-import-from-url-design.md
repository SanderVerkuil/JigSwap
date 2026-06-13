# JigSwap — Puzzle Import from Store URL (Design Spec)

**Date:** 2026-06-13
**Branch:** `worktree-puzzle-import-from-url`
**Status:** Approved design — ready for implementation planning

## Goal

Let a user paste a store product URL. The backend fetches and parses the page,
extracts puzzle metadata, and returns a **draft** that prefills the existing
add-puzzle form. The user reviews and confirms before anything is created.
Extraction never auto-creates a puzzle.

## Locked decisions

| Decision              | Choice                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Extraction layering   | Outbound `StorePageFetcher` port (Convex Node adapter wrapping `ogie`) + **pure** domain extractor that maps raw page data → draft |
| v1 scope              | EAN/UPC dedup, server-side image storage, **and** scrape caching all in v1                                                         |
| Confirm orchestration | Frontend calls image action → storage ID, then reuses the **existing** `submitPuzzleDefinition` mutation                           |
| Scraper library       | `ogie` v2.1.0 (MIT) — secure by default, built-in SSRF / private-IP blocking                                                       |
| Post-create behavior  | Mirror the **existing** add-puzzle form exactly (create `pending` definition; no behavior change)                                  |
| Import bar placement  | Shared `<PuzzleImportBar>` component used in **both** `/puzzles/add` and `/my-puzzles/add`                                         |

## Architecture (hexagonal, by layer)

The repo is DDD + hexagonal with Convex as adapters. This feature slots into the
existing **Catalog** bounded context, branching into **Library** (`acquireCopy`)
on a dedup hit. It reuses `submitPuzzleDefinition` for creation; the only net-new
backend capabilities are _fetch/parse a store page_ and _server-side image fetch+store_.

### 1. Domain — pure TypeScript, no Convex / no network

Location: `packages/domain/src/catalog/`

- **`domain/puzzle-import-draft.ts`**
  - `PuzzleImportDraft` value type:
    ```ts
    {
      title: string;
      brand?: string;
      imageUrl?: string;    // remote URL, NOT stored yet
      description?: string;
      ean?: string;         // gtin13 / gtin
      upc?: string;         // gtin12
      pieceCount?: number;
      sourceUrl: string;
    }
    ```
  - `RawProductPage` — a stable, scraper-agnostic shape the pure extractor consumes
    (decouples the domain from `ogie`'s types):
    ```ts
    {
      ogTitle?: string;
      ogDescription?: string;
      ogImages: string[];
      basicTitle?: string;      // <title>
      basicDescription?: string; // <meta name="description">
      jsonLdProducts: JsonLdProduct[]; // entries with @type "Product"
    }
    type JsonLdProduct = {
      name?: string;
      brand?: string;          // string or { name }
      description?: string;
      image?: string | string[];
      gtin13?: string; gtin12?: string; gtin?: string;
    }
    ```

- **`domain/extract-puzzle-draft.ts`** — `extractPuzzleDraft(raw, sourceUrl): PuzzleImportDraft`
  - Tiered, in order:
    1. **schema.org JSON-LD `Product`** → name, brand, image, gtin → ean/upc, description (primary).
    2. **OpenGraph / Twitter** → title, image, description fallback.
    3. **`<title>` / `<meta description>`** → last-resort fallback.
    4. **Piece count** via regex on title + description:
       `/(\d{3,5})\s*(pieces|stukjes|teile|pcs|piezas|pièces)/i` (multilingual, EU shops).
  - `gtin13`/`gtin` of length 13 → `ean`; `gtin12` (length 12) → `upc`.
  - Title is required; if no title can be derived from any tier, the result is a
    partial draft with `title: ""` — the caller decides whether that is "usable".
  - **Pure and fully unit-tested with hand-built `RawProductPage` fixtures.**

- **`domain/normalize-store-url.ts`** — `normalizeStoreUrl(url): string`
  - Lowercase scheme + host, drop URL fragment, strip `utm_*` / `gclid` / `fbclid`
    tracking params, trim trailing slash. Drives the cache key. Pure + unit-tested.

- **`application/ports/out/store-page-fetcher.ts`**
  - `interface StorePageFetcher { fetch(url: string): Promise<Result<RawProductPage, StorePageFetchError>>; }`
  - `StorePageFetchError` variants: `invalid-url`, `blocked` (SSRF), `timeout`,
    `not-found`, `fetch-failed`, `unparseable`.

- **`application/use-cases/extract-puzzle-draft.ts`** — `makeExtractPuzzleDraft({ fetcher })`
  - Mirrors the existing `makeSubmitPuzzleDefinition` factory + DI convention.
  - Runs `fetcher.fetch(url)` → on success calls pure `extractPuzzleDraft` → returns
    `Result<PuzzleImportDraft, StorePageFetchError>`.
  - **Does not touch the repository and does not persist.** Dedup is composed by the
    driving adapter (action) because Convex actions reach the DB via `runQuery`, not a
    repository bound to `ctx.db`.

### 2. Backend adapters — Convex

Location: `packages/backend/convex/catalog/`

- **`adapters/ogieStorePageFetcher.ts`** — `StorePageFetcher` impl (used only inside the Node action)
  - Calls `ogie.extract(url, { timeout: 10000, userAgent: "JigSwapBot/1.0", maxRedirects: 5 })`.
  - `ogie` provides SSRF / private-IP blocking and URL validation (secure by default).
  - Maps `ogie`'s `{ og, twitter, basic, jsonLd }` → our `RawProductPage`.
  - Maps `ogie` error codes (`INVALID_URL`, `FETCH_ERROR`, …) → `StorePageFetchError` variants.
  - Implementation reference: the `dobroslavradosavljevic/ogie` agent skill documents
    the exact `extract`/`extractFromHtml` return shape — consult it while wiring this adapter.

- **`extractFromUrl.ts`** — Node action (`"use node";`), the driving adapter. Thin:
  1. `normalizeStoreUrl(url)`.
  2. `getCachedImport(normalizedUrl)` (via `runQuery`). If fresh (< TTL), use cached draft; skip fetch.
  3. Else build `ogieStorePageFetcher`, run `makeExtractPuzzleDraft`, then
     `putCachedImport` (via `runMutation`).
  4. Compute the dedup `match` **fresh** every call via `findPuzzleByBarcode` (catalog
     changes between calls; never cache the match).
  5. Return `{ draft, match }` where `match` is null or the existing-puzzle summary.
  - On any extraction failure, return `{ draft: null, error: <variant> }` — **never throw**;
    the UI degrades to manual entry.

- **`findPuzzleByBarcode.ts`** — query
  - Args `{ ean?, upc? }`. Look up `puzzles.by_ean` then `puzzles.by_upc`.
  - Returns minimal match summary or `null`:
    `{ puzzleId, aggregateId, title, brand?, pieceCount, imageUrl }`.
  - Returns only `approved` definitions plus the **caller's own** pending submissions
    (parity with the my-puzzles search, which already surfaces own-pending puzzles).
    Resolve `imageUrl` via `ctx.storage.getUrl(puzzle.image)`.

- **`importCache.ts`** — internal cache adapter
  - `getCachedImport({ normalizedUrl })` query → row or null.
  - `putCachedImport({ normalizedUrl, draft })` mutation → upsert with `fetchedAt`.
  - Caching is infrastructure, not domain — it lives here, not in `packages/domain`.

### 3. Image fetch + store — Convex

Location: `packages/backend/convex/catalog/importPuzzleImage.ts` — Node action (`"use node";`)

- Args `{ url: string }`. Returns `Id<"_storage">`.
- **Own SSRF guard is required here** — `ogie` protects only the _page_ fetch, not this
  separate raw image fetch:
  - Validate protocol is http/https.
  - Resolve host; reject loopback / private (10/8, 172.16/12, 192.168/16) / link-local
    (169.254/16, fe80::/10) / unique-local (fc00::/7) ranges. Implemented as a pure,
    unit-tested `isPrivateHost(hostname): boolean` helper.
- Fetch with `User-Agent: JigSwapBot/1.0`, `AbortSignal.timeout(10000)`.
- Validate response `content-type` starts with `image/`.
- Cap size at 10 MB (check `content-length` and enforce while reading the body).
- `ctx.storage.store(blob)` → return the storage ID.
- Errors throw a typed Convex error; the frontend treats image failure as non-fatal and
  proceeds to create the puzzle without an image.

### 4. Schema change

Location: `packages/backend/convex/schema.ts` — one new table:

```ts
puzzleImportCache: defineTable({
  normalizedUrl: v.string(),
  draft: v.object({
    title: v.string(),
    brand: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    ean: v.optional(v.string()),
    upc: v.optional(v.string()),
    pieceCount: v.optional(v.number()),
    sourceUrl: v.string(),
  }),
  fetchedAt: v.number(),
}).index("by_url", ["normalizedUrl"]);
```

- TTL: 7 days, enforced at read time (`extractFromUrl` treats stale rows as a miss).
- No change to the `puzzles` table; `image` remains `v.id("_storage")` and the import
  flow simply supplies a storage ID like the existing form does.

### 5. Gateway

Location: `packages/gateway/` — expose:

- `catalog.extractPuzzleFromUrl` → `extractFromUrl` action.
- `catalog.importPuzzleImage` → `importPuzzleImage` action.

Reuse existing gateway entries unchanged: `catalog.createPuzzle` (= `submitPuzzleDefinition`),
`library.createOwned` / `library.updateSharing` (acquire-copy path), `catalog.puzzleById`.

### 6. Frontend — TanStack Start (`apps/web/`)

- **`components/puzzle-import/puzzle-import-bar.tsx`** — reusable component.
  - URL input + "Fetch details" button. `usePuzzleImport` hook holds
    `{ status: idle|loading|error|ready, draft, match }`.
  - On **ready, no match** → call `onDraft(draft)` so the host page prefills its
    `<PuzzleForm>` default values; show the remote image as a _preview only_ (stored on confirm).
  - On **ready, match** → render "This puzzle is already on JigSwap — add it to your
    collection?" with a primary action and a secondary "create new anyway."
  - On **error / partial** → toast "Couldn't read that page — add the details manually,"
    leave the form usable. **No hard error states.**

- **`/puzzles/add` (`routes/_dashboard/puzzles/add.tsx`)** — full catalog form.
  - Add `<PuzzleImportBar>` above `<PuzzleForm>`; draft prefills all matching fields.
  - Confirm (create path), in the existing `handleSubmit`:
    1. If `draft.imageUrl` and the user did not replace it with an upload → call
       `catalog.importPuzzleImage(imageUrl)` → storage ID (failure is non-fatal).
    2. Call existing `catalog.createPuzzle({ ...reviewedFields, image: storageId })`.
  - Match branch: primary action links to `/my-puzzles/add?puzzleId=<matchedPuzzleId>`
    (the existing acquire-copy entry point).

- **`/my-puzzles/add` (`routes/_dashboard/my-puzzles/add.tsx`)** — add-to-collection flow.
  - Add `<PuzzleImportBar>` near the search combobox.
  - Match branch → select the matched puzzle (`handlePuzzleSelect`) and continue the
    existing acquire-copy flow (condition / availability / acquire).
  - No-match branch → open the existing "create new puzzle" dialog with the draft prefilled,
    reusing `handleCreatePuzzle` (which already collects a subset of fields; unused draft
    fields are simply dropped, matching current behavior).

## End-to-end flows

**Extract**

```
UI paste URL → catalog.extractPuzzleFromUrl(url)
  → normalize → cache hit? use draft : (ogie fetch+parse → cache)
  → findPuzzleByBarcode(ean,upc)  [fresh]
  → { draft, match }
```

**Confirm — create new (no match)**

```
draft.imageUrl ─► catalog.importPuzzleImage(url) → storageId   (non-fatal on failure)
              ─► catalog.createPuzzle({ ...reviewed, image: storageId })   [pending]
```

**Confirm — duplicate (match)**

```
/puzzles/add      → link to /my-puzzles/add?puzzleId=<id>
/my-puzzles/add   → select match → acquire copy (existing condition/availability flow)
```

## Safety requirements

- **Page SSRF:** handled by `ogie` (private-IP blocking, URL validation).
- **Image SSRF:** handled by our own `isPrivateHost` guard in `importPuzzleImage`.
- **Fetch safety:** `User-Agent: JigSwapBot/1.0`, `AbortSignal.timeout(10000)` on every fetch.
- **Image validation:** `content-type` must be `image/*`; size capped at 10 MB.
- **Auth:** `submittedBy` is always derived from `requireMember(ctx)`; never user-supplied.
- **Barcode uniqueness:** existing domain rule in `submitPuzzleDefinition` is unchanged; the
  dedup query simply surfaces an existing match _before_ the user reaches that rule.
- **Graceful degradation:** every failure path returns a usable draft-less response and the
  UI falls back to manual entry. No unhandled errors surface to the user.

## Testing strategy

- **Pure unit (domain pkg, no network/Convex):**
  - `extractPuzzleDraft`: JSON-LD-rich page, OG-only page, title-only fallback,
    multilingual piece-count (pieces/stukjes/teile/pcs), `gtin13`→ean / `gtin12`→upc,
    missing-title partial.
  - `normalizeStoreUrl`: tracking-param stripping, fragment/host casing, trailing slash.
  - `isPrivateHost`: loopback, RFC-1918, link-local, IPv6 ULA, public host passes.
- **Use case:** `makeExtractPuzzleDraft` with a **fake `StorePageFetcher`** —
  success / each error variant / partial page.
- **Convex (`convex-test`):**
  - `extractFromUrl` with a **stubbed fetcher** (inject via factory) to exercise the
    cache-hit / cache-miss / dedup-match / no-match wiring without real network.
  - `findPuzzleByBarcode`: approved match, own-pending match, no match.
  - `importPuzzleImage`: content-type rejection and size-cap rejection via the pure helpers.

## Implementation reference

- `ogie` v2.1.0 API (`extract`, `extractFromHtml`, result `{ success, data:{ og, twitter,
basic, jsonLd }, error:{ code } }`). The `dobroslavradosavljevic/ogie` agent skill can be
  added during implementation for authoritative API details.

## Deltas from the original spec

1. **Not** flat `convex/puzzleImport.ts` + `images.ts` — slotted into `catalog/` adapters +
   `packages/domain` to honor the existing hexagonal architecture.
2. `ogie` instead of `open-graph-scraper` (per decision); both are isolated behind the
   `StorePageFetcher` port and trivially swappable.
3. EAN-dedup reuses existing barcode domain logic + the existing acquire-copy flow rather
   than new persistence code.
4. The **image** fetch needs its own SSRF guard; `ogie`'s protection covers only the page.
5. The import bar is shared across both add flows; the dedup branch behaves differently per
   flow (link-out vs. direct select).

## Out of scope (v1)

- Firecrawl / scraping-API fallback for blocked domains (e.g. Amazon).
- Background / queued scraping — the synchronous Node action is sufficient.
- Auto-acquiring a copy on catalog creation (post-create behavior mirrors the current form).
- Resolving the existing "pending puzzle can't be acquired until approved" friction — left
  as-is; out of scope for this feature.

## Open risks

- Convex Node actions cannot directly access `ctx.db`; the action composes the use case for
  extraction but performs cache + dedup via `runQuery` / `runMutation`. Confirm the project's
  `convex/_generated` exposes internal query/mutation references for these.
- `ogie`'s exact field names (especially JSON-LD product shape) must be verified against the
  installed version when wiring the adapter; the mapping layer isolates any surprises.
