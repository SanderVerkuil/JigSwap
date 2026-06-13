# Puzzle Title Cleaning + Firecrawl Fallback Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add smart title cleaning to strip noise/piece-counts from imported puzzle titles (domain, TDD), and add a Firecrawl-backed HTTP fetcher as a last-resort fallback behind the existing browser-UA tier.

**Architecture:** Feature 1 is pure domain logic — `cleanPuzzleTitle` lives in `packages/domain/src/catalog/domain/` and is applied at the end of `extractPuzzleDraft`. Feature 2 is a new adapter in `packages/backend/convex/catalog/adapters/` wired into `extractFromUrl.ts` as the third tier. No new dependencies; Firecrawl uses global `fetch`.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo, hexagonal architecture (domain + backend/convex packages), ogie for HTML parsing, Prettier for formatting.

---

## File map

| Status | Path                                                                    | Role                                   |
| ------ | ----------------------------------------------------------------------- | -------------------------------------- |
| CREATE | `packages/domain/src/catalog/domain/clean-puzzle-title.ts`              | Pure `cleanPuzzleTitle` function       |
| CREATE | `packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts`         | Spec for `cleanPuzzleTitle`            |
| MODIFY | `packages/domain/src/catalog/domain/extract-puzzle-draft.ts`            | Apply `cleanPuzzleTitle` after parsing |
| MODIFY | `packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts`       | Update title expectations              |
| MODIFY | `packages/domain/src/catalog/domain/index.ts`                           | Re-export `cleanPuzzleTitle`           |
| CREATE | `packages/backend/convex/catalog/adapters/firecrawlStorePageFetcher.ts` | Firecrawl adapter                      |
| MODIFY | `packages/backend/convex/catalog/extractFromUrl.ts`                     | Wire firecrawl as 3rd tier             |

---

## Task 1: Write failing spec for `cleanPuzzleTitle`

**Files:**

- Create: `packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts`

- [ ] **Step 1.1: Write the failing test file**

```typescript
// packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts
import { describe, expect, it } from "vitest";
import { cleanPuzzleTitle } from "./clean-puzzle-title";

describe("cleanPuzzleTitle", () => {
  it("strips piece count and noise segments (Dutch)", () => {
    expect(
      cleanPuzzleTitle(
        "Jan van Haasteren Jungletocht - 1000 stukjes puzzel - Gerecycled karton",
      ),
    ).toBe("Jan van Haasteren Jungletocht");
  });

  it("strips trailing piece count phrase (English)", () => {
    expect(cleanPuzzleTitle("Ravensburger Mountain Vista 1000 pieces")).toBe(
      "Ravensburger Mountain Vista",
    );
  });

  it("leaves a clean title untouched", () => {
    expect(cleanPuzzleTitle("Starry Night")).toBe("Starry Night");
  });

  it("joins kept segments with a space and drops the separator", () => {
    // "Educa" and "Sterrenhemel" both survive; "1500 stukjes" is dropped
    expect(cleanPuzzleTitle("Educa - Sterrenhemel - 1500 stukjes")).toBe(
      "Educa Sterrenhemel",
    );
  });

  it("returns trimmed input when result would be empty", () => {
    expect(cleanPuzzleTitle("  puzzel  ")).toBe("puzzel");
    expect(cleanPuzzleTitle("1000 stukjes")).toBe("1000 stukjes");
  });

  it("handles empty string input", () => {
    expect(cleanPuzzleTitle("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(cleanPuzzleTitle("   ")).toBe("");
  });

  it("strips noise words mid-segment", () => {
    // "jigsaw" is a noise word, gets removed; number stays if no unit
    expect(cleanPuzzleTitle("City Skyline Jigsaw Puzzle")).toBe("City Skyline");
  });

  it("strips German Teile piece count", () => {
    expect(cleanPuzzleTitle("Berglandschaft 500 Teile Puzzle")).toBe(
      "Berglandschaft",
    );
  });

  it("strips thousands-separator piece counts", () => {
    expect(cleanPuzzleTitle("Beautiful Landscape 1.000 stukjes")).toBe(
      "Beautiful Landscape",
    );
  });

  it("drops audience segment (adults)", () => {
    expect(cleanPuzzleTitle("Flower Garden Puzzle - 500 pieces - Adults")).toBe(
      "Flower Garden Puzzle",
    );
  });

  it("drops material segment (cardboard)", () => {
    expect(
      cleanPuzzleTitle("Ocean View - 1000 pieces - Recycled cardboard"),
    ).toBe("Ocean View");
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm exec vitest run packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts
```

Expected: FAIL — "Cannot find module './clean-puzzle-title'"

---

## Task 2: Implement `cleanPuzzleTitle`

**Files:**

- Create: `packages/domain/src/catalog/domain/clean-puzzle-title.ts`

- [ ] **Step 2.1: Write the implementation**

```typescript
// packages/domain/src/catalog/domain/clean-puzzle-title.ts

// Matches piece-count phrases (with optional thousands separators):
//   "1000 pieces", "1.000 stukjes", "500 pcs", "2000 Teile", etc.
// Captures the numeric part AND the unit word so both can be removed.
const PIECE_PHRASE_RE =
  /(\d[\d.,\s]{0,7}\d|\d+)\s*(?:pieces?|pcs|stukjes|stukken|stuks|teile|piezas|pi[eè]ces)\b/gi;

// Generic puzzle/jigsaw noise tokens — whole-word, case-insensitive.
const NOISE_TOKEN_RE = /\b(?:puzzle|puzzel|legpuzzel|jigsaw|jigsawpuzzle)\b/gi;

// A segment consisting ONLY of material or audience descriptors is dropped entirely.
// We keep it as a segment-level drop (not word-level) to avoid partial matches.
const DROP_SEGMENT_RE =
  /^(?:karton|cardboard|recycled|gerecycld|gerecycled|hout|houten|wooden|volwassenen|adults|kinderen|children|\d+\+?\s*(?:jaar|years|yr))$/i;

// Separator patterns used to split the raw title into segments.
const SEGMENT_SPLIT_RE = / [-–—] | [|] | \/ /g;

/**
 * Cleans a raw puzzle title by:
 * 1. Splitting on common separators (` - `, `–`, `|`, ` / `).
 * 2. Removing piece-count phrases (number + unit word) from each segment.
 * 3. Removing generic noise tokens (puzzle, jigsaw, etc.) from each segment.
 * 4. Dropping any segment that is now empty or is a material/audience-only descriptor.
 * 5. Joining surviving segments with a space.
 * 6. Falling back to the trimmed raw input if everything was dropped.
 */
export const cleanPuzzleTitle = (
  raw: string,
  _opts: { brand?: string; pieceCount?: number } = {},
): string => {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const segments = trimmed
    .split(SEGMENT_SPLIT_RE)
    .map((seg) => {
      // Remove piece-count phrases first (number + unit together).
      let cleaned = seg.replace(PIECE_PHRASE_RE, "");
      // Remove noise tokens.
      cleaned = cleaned.replace(NOISE_TOKEN_RE, "");
      // Collapse multiple spaces and trim.
      return cleaned.replace(/\s+/g, " ").trim();
    })
    .filter((seg) => {
      if (!seg) return false;
      // Drop if the entire (cleaned) segment is a material or audience token.
      return !DROP_SEGMENT_RE.test(seg);
    });

  if (segments.length === 0) return trimmed;

  return segments.join(" ");
};
```

- [ ] **Step 2.2: Run tests to confirm they pass**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm exec vitest run packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts
```

Expected: All 13 tests PASS.

---

## Task 3: Export `cleanPuzzleTitle` from the domain barrel

**Files:**

- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 3.1: Add export**

In `packages/domain/src/catalog/domain/index.ts`, add after the `extract-puzzle-draft` line:

```typescript
export * from "./clean-puzzle-title";
```

The file currently looks like:

```typescript
export * from "./approval";
export * from "./barcode";
export * from "./catalog-category";
export * from "./errors";
export * from "./events";
export * from "./extract-puzzle-draft";
export * from "./ids";
export * from "./is-private-ip";
export * from "./normalize-store-url";
export * from "./piece-count";
export * from "./puzzle-definition";
export * from "./puzzle-import-draft";
export * from "./store-page-fetch-error";
```

Add the new export after the `extract-puzzle-draft` line, in alphabetical order — `clean-puzzle-title` sorts before `errors`, so insert as the second line:

```typescript
export * from "./approval";
export * from "./barcode";
export * from "./catalog-category";
export * from "./clean-puzzle-title";
export * from "./errors";
export * from "./events";
export * from "./extract-puzzle-draft";
export * from "./ids";
export * from "./is-private-ip";
export * from "./normalize-store-url";
export * from "./piece-count";
export * from "./puzzle-definition";
export * from "./puzzle-import-draft";
export * from "./store-page-fetch-error";
```

- [ ] **Step 3.2: Run typecheck**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm --filter @jigswap/domain exec tsc --noEmit
```

Expected: no errors.

---

## Task 4: Apply `cleanPuzzleTitle` in `extractPuzzleDraft` and update its spec

**Files:**

- Modify: `packages/domain/src/catalog/domain/extract-puzzle-draft.ts`
- Modify: `packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts`

- [ ] **Step 4.1: Update `extract-puzzle-draft.ts`**

The current implementation (lines 44-65):

```typescript
export const extractPuzzleDraft = (
  raw: RawProductPage,
  sourceUrl: string,
): PuzzleImportDraft => {
  const product = raw.jsonLdProducts[0];
  const title = (product?.name ?? raw.ogTitle ?? raw.basicTitle ?? "").trim();
  const description = clean(
    product?.description ?? raw.ogDescription ?? raw.basicDescription,
  );
  const { ean, upc } = barcodes(product);

  return {
    title,
    brand: clean(product?.brand),
    imageUrl: firstImage(product?.image) ?? raw.ogImages[0],
    description,
    ean,
    upc,
    pieceCount: parsePieceCount(`${title} ${description ?? ""}`),
    sourceUrl,
  };
};
```

Replace with:

```typescript
import { cleanPuzzleTitle } from "./clean-puzzle-title";

// ... (keep all existing code above unchanged) ...

export const extractPuzzleDraft = (
  raw: RawProductPage,
  sourceUrl: string,
): PuzzleImportDraft => {
  const product = raw.jsonLdProducts[0];
  // Compute rawTitle BEFORE cleaning — pieceCount is parsed from it.
  const rawTitle = (
    product?.name ??
    raw.ogTitle ??
    raw.basicTitle ??
    ""
  ).trim();
  const description = clean(
    product?.description ?? raw.ogDescription ?? raw.basicDescription,
  );
  const { ean, upc } = barcodes(product);
  const brand = clean(product?.brand);
  // Parse piece count from the ORIGINAL title + description so cleaning doesn't lose the count.
  const pieceCount = parsePieceCount(`${rawTitle} ${description ?? ""}`);
  // Clean title AFTER deriving pieceCount (cleaning may strip the count phrase).
  const title = cleanPuzzleTitle(rawTitle, { brand, pieceCount });

  return {
    title,
    brand,
    imageUrl: firstImage(product?.image) ?? raw.ogImages[0],
    description,
    ean,
    upc,
    pieceCount,
    sourceUrl,
  };
};
```

The full updated file (add the import at top, update the function body):

```typescript
// packages/domain/src/catalog/domain/extract-puzzle-draft.ts
import type {
  JsonLdProduct,
  PuzzleImportDraft,
  RawProductPage,
} from "./puzzle-import-draft";
import { cleanPuzzleTitle } from "./clean-puzzle-title";

// Multilingual piece-count: EN pieces/pcs, NL stukjes, DE Teile, ES piezas, FR pieces. Captures
// an integer that may carry `.`/`,`/space thousands separators (e.g. "1.000", "1,500").
const PIECE_COUNT_RE =
  /(\d[\d.,\s]{0,7}\d|\d)\s*(?:pieces?|pcs|stukjes|teile|piezas|pi[eè]ces)\b/i;

const parsePieceCount = (text: string): number | undefined => {
  const match = text.match(PIECE_COUNT_RE);
  if (!match) return undefined;
  const n = Number.parseInt(match[1].replace(/[.,\s]/g, ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : undefined;
};

const firstImage = (
  image: string | readonly string[] | undefined,
): string | undefined =>
  Array.isArray(image) ? image[0] : (image as string | undefined);

const barcodes = (
  product: JsonLdProduct | undefined,
): { ean?: string; upc?: string } => {
  const gtin13 =
    product?.gtin13 ??
    (product?.gtin?.length === 13 ? product.gtin : undefined);
  const gtin12 =
    product?.gtin12 ??
    (product?.gtin?.length === 12 ? product.gtin : undefined);
  return { ean: gtin13, upc: gtin12 };
};

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

// Tiered, in order: JSON-LD Product -> OpenGraph -> <title>/<meta>. Piece count regex runs over
// title + description. Title is "" when no tier yields one; the caller decides if that is usable.
export const extractPuzzleDraft = (
  raw: RawProductPage,
  sourceUrl: string,
): PuzzleImportDraft => {
  const product = raw.jsonLdProducts[0];
  // Compute rawTitle BEFORE cleaning — pieceCount is parsed from it.
  const rawTitle = (
    product?.name ??
    raw.ogTitle ??
    raw.basicTitle ??
    ""
  ).trim();
  const description = clean(
    product?.description ?? raw.ogDescription ?? raw.basicDescription,
  );
  const { ean, upc } = barcodes(product);
  const brand = clean(product?.brand);
  // Parse piece count from the ORIGINAL title + description so cleaning doesn't lose the count.
  const pieceCount = parsePieceCount(`${rawTitle} ${description ?? ""}`);
  // Clean title AFTER deriving pieceCount (cleaning may strip the count phrase).
  const title = cleanPuzzleTitle(rawTitle, { brand, pieceCount });

  return {
    title,
    brand,
    imageUrl: firstImage(product?.image) ?? raw.ogImages[0],
    description,
    ean,
    upc,
    pieceCount,
    sourceUrl,
  };
};
```

- [ ] **Step 4.2: Update `extract-puzzle-draft.spec.ts` for cleaned titles**

The following test expectations change because `cleanPuzzleTitle` is now applied:

1. `"prefers JSON-LD Product fields (tier 1)"`: title was `"Ravensburger Mountain Vista 1000 pieces"` → now `"Ravensburger Mountain Vista"`. The `pieceCount` assertion stays `toBe(1000)` — it's still parsed from the raw title before cleaning.

2. `"falls back to OpenGraph then <title> (tiers 2-3)"`:
   - `"OG Puzzle 500 stukjes"` → after cleaning strips `stukjes` unit, `Puzzle` noise → `"OG"`. Assert `"OG"`.
   - `"Basic 750 Teile"` → strips `Teile` unit → `"Basic"`. Assert `"Basic"`.

3. `"parses multilingual piece counts incl. thousands separators"`: The `pc` helper only checks `.pieceCount`, NOT `.title`, so these assertions do NOT change.

Full updated spec:

```typescript
// packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts
import { describe, expect, it } from "vitest";
import { extractPuzzleDraft } from "./extract-puzzle-draft";
import type { RawProductPage } from "./puzzle-import-draft";

const empty: RawProductPage = { ogImages: [], jsonLdProducts: [] };
const SRC = "https://shop.example.com/p/1";

describe("extractPuzzleDraft", () => {
  it("prefers JSON-LD Product fields (tier 1)", () => {
    const raw: RawProductPage = {
      ...empty,
      ogTitle: "OG fallback title",
      ogImages: ["https://img/og.jpg"],
      jsonLdProducts: [
        {
          name: "Ravensburger Mountain Vista 1000 pieces",
          brand: "Ravensburger",
          description: "A scenic 1000 piece puzzle",
          image: "https://img/product.jpg",
          gtin13: "4005556150007",
        },
      ],
    };
    const d = extractPuzzleDraft(raw, SRC);
    expect(d.title).toBe("Ravensburger Mountain Vista");
    expect(d.brand).toBe("Ravensburger");
    expect(d.imageUrl).toBe("https://img/product.jpg");
    expect(d.ean).toBe("4005556150007");
    expect(d.upc).toBeUndefined();
    expect(d.pieceCount).toBe(1000);
    expect(d.sourceUrl).toBe(SRC);
  });

  it("falls back to OpenGraph then <title> (tiers 2-3)", () => {
    expect(
      extractPuzzleDraft(
        {
          ...empty,
          ogTitle: "OG Puzzle 500 stukjes",
          ogImages: ["https://img/og.jpg"],
        },
        SRC,
      ).title,
    ).toBe("OG");
    expect(
      extractPuzzleDraft({ ...empty, basicTitle: "Basic 750 Teile" }, SRC)
        .title,
    ).toBe("Basic");
  });

  it("parses multilingual piece counts incl. thousands separators", () => {
    const pc = (title: string) =>
      extractPuzzleDraft({ ...empty, basicTitle: title }, SRC).pieceCount;
    expect(pc("Puzzle 1000 pieces")).toBe(1000);
    expect(pc("Legpuzzel 1.000 stukjes")).toBe(1000);
    expect(pc("Puzzle 1,500 pcs")).toBe(1500);
    expect(pc("Puzzle 500 Teile")).toBe(500);
    expect(pc("Rompecabezas 2000 piezas")).toBe(2000);
    expect(pc("No count here")).toBeUndefined();
  });

  it("maps gtin12 to upc", () => {
    const d = extractPuzzleDraft(
      { ...empty, jsonLdProducts: [{ name: "X", gtin12: "036000291452" }] },
      SRC,
    );
    expect(d.upc).toBe("036000291452");
    expect(d.ean).toBeUndefined();
  });

  it("returns an empty title when nothing is extractable", () => {
    expect(extractPuzzleDraft(empty, SRC).title).toBe("");
  });
});
```

- [ ] **Step 4.3: Run all domain tests**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm exec vitest run packages/domain
```

Expected: All tests PASS (including updated `extract-puzzle-draft.spec` and new `clean-puzzle-title.spec`).

- [ ] **Step 4.4: Run domain typecheck**

```bash
pnpm --filter @jigswap/domain exec tsc --noEmit
```

Expected: no errors.

---

## Task 5: Format and commit Feature 1

**Files changed:** `clean-puzzle-title.ts`, `clean-puzzle-title.spec.ts`, `index.ts`, `extract-puzzle-draft.ts`, `extract-puzzle-draft.spec.ts`

- [ ] **Step 5.1: Prettier**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm exec prettier --write \
  packages/domain/src/catalog/domain/clean-puzzle-title.ts \
  packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts \
  packages/domain/src/catalog/domain/index.ts \
  packages/domain/src/catalog/domain/extract-puzzle-draft.ts \
  packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts
```

- [ ] **Step 5.2: Verify format check**

```bash
pnpm run format:check
```

Expected: no errors.

- [ ] **Step 5.3: Re-run tests to confirm formatting didn't break anything**

```bash
pnpm exec vitest run packages/domain
```

Expected: all PASS.

- [ ] **Step 5.4: Commit**

```bash
git -C /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url add \
  packages/domain/src/catalog/domain/clean-puzzle-title.ts \
  packages/domain/src/catalog/domain/clean-puzzle-title.spec.ts \
  packages/domain/src/catalog/domain/index.ts \
  packages/domain/src/catalog/domain/extract-puzzle-draft.ts \
  packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts
git -C /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url commit -m "feat(catalog): smart title cleaning (strip piece-count/noise)"
```

---

## Task 6: Implement `firecrawlStorePageFetcher`

**Files:**

- Create: `packages/backend/convex/catalog/adapters/firecrawlStorePageFetcher.ts`

- [ ] **Step 6.1: Write the adapter**

Key design points:

- No `"use node"` directive (no `node:` builtins; uses global `fetch` and `process.env`).
- Mirror the import style of `ogieStorePageFetcher.ts`.
- POST to Firecrawl `/v1/scrape` with `formats: ["html"]`.
- Parse the response with `extractFromHtml` (from ogie) + `mapOgieError`/`toRawProductPage` from the shared adapter helper.

```typescript
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
```

- [ ] **Step 6.2: Typecheck the backend**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: no errors.

---

## Task 7: Wire Firecrawl as the 3rd fallback tier in `extractFromUrl.ts`

**Files:**

- Modify: `packages/backend/convex/catalog/extractFromUrl.ts`

- [ ] **Step 7.1: Update the import and fetcher chain**

In `packages/backend/convex/catalog/extractFromUrl.ts`:

1. Add import at the top (after the existing adapter imports):

```typescript
import { firecrawlStorePageFetcher } from "./adapters/firecrawlStorePageFetcher";
```

2. Replace the `fetcher:` line:

```typescript
// Before:
fetcher: makeFallbackStorePageFetcher(
  ogieStorePageFetcher,
  browserStorePageFetcher,
),

// After:
fetcher: makeFallbackStorePageFetcher(
  ogieStorePageFetcher,
  makeFallbackStorePageFetcher(browserStorePageFetcher, firecrawlStorePageFetcher),
),
```

- [ ] **Step 7.2: Typecheck backend again**

```bash
pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3: Run all tests**

```bash
pnpm exec vitest run packages/domain packages/backend
```

Expected: all PASS.

---

## Task 8: Format and commit Feature 2

**Files changed:** `firecrawlStorePageFetcher.ts`, `extractFromUrl.ts`

- [ ] **Step 8.1: Prettier**

```bash
cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url
pnpm exec prettier --write \
  packages/backend/convex/catalog/adapters/firecrawlStorePageFetcher.ts \
  packages/backend/convex/catalog/extractFromUrl.ts
```

- [ ] **Step 8.2: Verify format check**

```bash
pnpm run format:check
```

Expected: no errors.

- [ ] **Step 8.3: Re-run all tests**

```bash
pnpm exec vitest run packages/domain packages/backend
```

Expected: all PASS.

- [ ] **Step 8.4: Commit**

```bash
git -C /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url add \
  packages/backend/convex/catalog/adapters/firecrawlStorePageFetcher.ts \
  packages/backend/convex/catalog/extractFromUrl.ts
git -C /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url commit -m "feat(backend): Firecrawl fallback tier (after browser-UA), credits-last"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] `cleanPuzzleTitle` function with correct signature — Task 2
- [x] All 5 spec examples from requirements — Task 1 covers: JvH Jungletocht, Mountain Vista, Starry Night, Educa Sterrenhemel, empty/whitespace
- [x] Export from `catalog/domain/index.ts` — Task 3
- [x] Applied in `extract-puzzle-draft.ts` using brand+pieceCount opts — Task 4
- [x] pieceCount computed from raw title+description BEFORE cleaning — Task 4
- [x] Updated `extract-puzzle-draft.spec.ts` expectations — Task 4
- [x] Firecrawl adapter with all specified logic — Task 6
- [x] No `"use node"` in firecrawl adapter — Task 6
- [x] 3-tier fallback chain — Task 7
- [x] Prettier before each commit — Tasks 5 and 8
- [x] typecheck both packages — Tasks 4.4, 6.2, 7.2
- [x] 2 separate commits with correct messages — Tasks 5.4 and 8.4

**Type consistency:**

- `firecrawlStorePageFetcher` typed as `StorePageFetcher` ✓
- `cleanPuzzleTitle(raw: string, opts: { brand?: string; pieceCount?: number } = {})` ✓
- Uses `extractFromHtml` and `mapOgieError` from the same imports as `browserStorePageFetcher` ✓
- `json.data.html` access pattern matches Firecrawl API spec ✓
