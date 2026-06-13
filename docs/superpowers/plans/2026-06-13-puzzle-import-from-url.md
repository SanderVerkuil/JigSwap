# Puzzle Import from Store URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a store product URL; the backend fetches and parses the page, returns a reviewable draft that prefills the existing add-puzzle form, with EAN/UPC dedup, server-side image storage, and scrape caching.

**Architecture:** Hexagonal. A pure domain layer (`extractPuzzleDraft`, `normalizeStoreUrl`, `isPrivateIp`, ports, `makeImportPuzzleFromUrl` use case) holds all testable logic. Convex Node actions are thin driving adapters that wire `ogie` (page fetch) + `ctx.runQuery/runMutation`-backed ports. Creation reuses the existing `submitPuzzleDefinition`; the dedup branch reuses the existing acquire-copy flow. One new table (`puzzleImportCache`).

**Tech Stack:** TypeScript, Convex (Node-runtime actions), `ogie` v2.1.0, TanStack Start + React, `convex/react` (`useAction`), Vitest, `convex-test`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-13-puzzle-import-from-url-design.md`

---

## File Structure

**Domain (`packages/domain/src/catalog/`)**
- `domain/puzzle-import-draft.ts` — `PuzzleImportDraft`, `RawProductPage`, `JsonLdProduct` types
- `domain/store-page-fetch-error.ts` — `StorePageFetchError` (DomainError subclass)
- `domain/normalize-store-url.ts` — `normalizeStoreUrl`
- `domain/extract-puzzle-draft.ts` — `extractPuzzleDraft` (tiered)
- `domain/is-private-ip.ts` — `isPrivateIp` (SSRF helper)
- `application/ports/out/store-page-fetcher.ts` — `StorePageFetcher`
- `application/ports/out/import-draft-cache.ts` — `ImportDraftCache`, `CachedImportDraft`
- `application/ports/out/puzzle-match-lookup.ts` — `PuzzleMatchLookup`, `PuzzleMatch`
- `application/ports/in/import-puzzle-from-url.port.ts` — `ImportPuzzleFromUrl`, `PuzzleImportResult`, `ImportPuzzleFromUrlCommand`
- `application/use-cases/import-puzzle-from-url.ts` — `makeImportPuzzleFromUrl`
- `application/testing/{fake-store-page-fetcher,in-memory-import-draft-cache,fake-puzzle-match-lookup}.ts` — test doubles
- `*.spec.ts` alongside each pure module + the use case

**Backend (`packages/backend/convex/`)**
- `schema.ts` — add `puzzleImportCache` table (modify)
- `catalog/importCache.ts` — `getCachedImport` (internalQuery), `putCachedImport` (internalMutation)
- `catalog/findPuzzleByBarcode.ts` — `findPuzzleByBarcode` (internalQuery)
- `catalog/adapters/ogieStorePageFetcher.ts` — `StorePageFetcher` impl over `ogie`
- `catalog/extractFromUrl.ts` — public Node action
- `catalog/importPuzzleImage.ts` — public Node action
- `package.json` — add `ogie` dep (modify)
- `*.test.ts` — convex-test coverage

**Gateway (`packages/gateway/src/operations.ts`)** — add two catalog entries (modify)

**Web (`apps/web/src/`)**
- `components/puzzle-import/use-puzzle-import.ts` — hook + `ImportedPuzzle` types
- `components/puzzle-import/draft-to-form-defaults.ts` — pure mapper
- `components/puzzle-import/puzzle-import-bar.tsx` — UI component
- `routes/_dashboard/puzzles/add.tsx` — integrate (modify)
- `routes/_dashboard/my-puzzles/add.tsx` — integrate (modify)
- `locales/{en,nl,source}.json` — add `puzzles.import*` keys (modify)

---

## Conventions (verbatim, copy these idioms)

`Result` — `packages/domain/src/shared-kernel/result.ts`: `ok(v)`, `err(e)`, `isOk`, `isErr`, fields `.isOk/.isErr/.value/.error`. Import inside domain via `from "../../../shared-kernel"` (depth varies).

`DomainError` base — `packages/domain/src/shared-kernel/domain-error.ts` (`export class DomainError extends Error`). Typed errors carry a stable `code` discriminant (see `CatalogApplicationError`).

Use-case factory idiom (`makeXxx(deps)` returning the inbound-port function) — mirror `makeSubmitPuzzleDefinition`.

Barrels are `export * from "./file"`. Add new files to the matching `index.ts`.

Convex: `action`, `internalQuery`, `internalMutation` from `./_generated/server`; `internal` from `./_generated/api`; `ctx.runQuery(internal.x.y, args)`, `ctx.runMutation(...)`, `ctx.storage.store(blob)`, `ctx.storage.getUrl(id)`.

Test commands (run from the worktree root): pure domain `pnpm exec vitest run packages/domain`; backend `pnpm exec vitest run packages/backend`; regenerate Convex types `pnpm --filter @jigswap/backend exec convex codegen`.

---

## Task 0: Baseline

**Files:** none

- [ ] **Step 1: Install deps in the worktree**

Run: `pnpm install`
Expected: completes; workspace linked.

- [ ] **Step 2: Establish a green baseline**

Run: `pnpm exec vitest run packages/domain packages/backend`
Expected: existing tests pass (0 failures). If anything fails, STOP and report before proceeding.

---

## Task 1: Draft + raw-page types

**Files:**
- Create: `packages/domain/src/catalog/domain/puzzle-import-draft.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Create the types**

```typescript
// packages/domain/src/catalog/domain/puzzle-import-draft.ts

// A reviewable draft extracted from a store page. Persists nothing; the user confirms before
// any puzzle is created. `imageUrl` is a remote URL, NOT a stored Convex storage id.
export interface PuzzleImportDraft {
  readonly title: string;
  readonly brand?: string;
  readonly imageUrl?: string;
  readonly description?: string;
  readonly ean?: string; // gtin13 / 13-digit gtin
  readonly upc?: string; // gtin12 / 12-digit gtin
  readonly pieceCount?: number;
  readonly sourceUrl: string;
}

// A scraper-agnostic normalization of a fetched product page. The page-fetcher adapter maps the
// concrete scraper output (ogie) into this shape so the pure extractor never sees ogie types.
export interface JsonLdProduct {
  readonly name?: string;
  readonly brand?: string; // already flattened from string | { name } by the adapter
  readonly description?: string;
  readonly image?: string | readonly string[];
  readonly gtin13?: string;
  readonly gtin12?: string;
  readonly gtin?: string;
}

export interface RawProductPage {
  readonly ogTitle?: string;
  readonly ogDescription?: string;
  readonly ogImages: readonly string[];
  readonly basicTitle?: string; // <title>
  readonly basicDescription?: string; // <meta name="description">
  readonly jsonLdProducts: readonly JsonLdProduct[];
}
```

- [ ] **Step 2: Export from the domain barrel**

Add to `packages/domain/src/catalog/domain/index.ts`:

```typescript
export * from "./puzzle-import-draft";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec vitest run packages/domain` (compiles on collect)
Expected: PASS (no tests added yet, existing suite green).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/catalog/domain/puzzle-import-draft.ts packages/domain/src/catalog/domain/index.ts
git commit -m "feat(catalog): add puzzle import draft + raw page types"
```

---

## Task 2: StorePageFetchError

**Files:**
- Create: `packages/domain/src/catalog/domain/store-page-fetch-error.ts`
- Test: `packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts
import { describe, expect, it } from "vitest";
import { StorePageFetchError } from "./store-page-fetch-error";

describe("StorePageFetchError", () => {
  it("carries a stable code discriminant", () => {
    expect(StorePageFetchError.invalidUrl("x").code).toBe("InvalidUrl");
    expect(StorePageFetchError.blocked("x").code).toBe("Blocked");
    expect(StorePageFetchError.timeout("x").code).toBe("Timeout");
    expect(StorePageFetchError.notFound("x").code).toBe("NotFound");
    expect(StorePageFetchError.fetchFailed("boom").code).toBe("FetchFailed");
    expect(StorePageFetchError.unparseable("x").code).toBe("Unparseable");
  });

  it("is an Error subclass", () => {
    expect(StorePageFetchError.timeout("x")).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/domain/src/catalog/domain/store-page-fetch-error.ts
import { DomainError } from "../../shared-kernel";

// Why a store page could not be turned into a draft. `code` is the stable, machine-readable
// discriminant transport/UI maps to; the message is for logs/tests only.
export type StorePageFetchErrorCode =
  | "InvalidUrl"
  | "Blocked"
  | "Timeout"
  | "NotFound"
  | "FetchFailed"
  | "Unparseable";

export class StorePageFetchError extends DomainError {
  override readonly name = "StorePageFetchError";

  private constructor(
    readonly code: StorePageFetchErrorCode,
    message: string,
  ) {
    super(message);
  }

  static invalidUrl(url: string): StorePageFetchError {
    return new StorePageFetchError("InvalidUrl", `Not a valid URL: ${url}`);
  }
  static blocked(url: string): StorePageFetchError {
    return new StorePageFetchError("Blocked", `Refused to fetch (blocked address): ${url}`);
  }
  static timeout(url: string): StorePageFetchError {
    return new StorePageFetchError("Timeout", `Timed out fetching ${url}`);
  }
  static notFound(url: string): StorePageFetchError {
    return new StorePageFetchError("NotFound", `Page not found: ${url}`);
  }
  static fetchFailed(message: string): StorePageFetchError {
    return new StorePageFetchError("FetchFailed", `Fetch failed: ${message}`);
  }
  static unparseable(url: string): StorePageFetchError {
    return new StorePageFetchError("Unparseable", `Could not parse metadata from ${url}`);
  }
}
```

Confirm the import path: from `catalog/domain/` to `shared-kernel` is `../../shared-kernel` (matches `catalog/application/errors.ts`).

- [ ] **Step 4: Export from barrel**

Add to `packages/domain/src/catalog/domain/index.ts`:

```typescript
export * from "./store-page-fetch-error";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/catalog/domain/store-page-fetch-error.ts packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts packages/domain/src/catalog/domain/index.ts
git commit -m "feat(catalog): add StorePageFetchError"
```

---

## Task 3: normalizeStoreUrl

**Files:**
- Create: `packages/domain/src/catalog/domain/normalize-store-url.ts`
- Test: `packages/domain/src/catalog/domain/normalize-store-url.spec.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/src/catalog/domain/normalize-store-url.spec.ts
import { describe, expect, it } from "vitest";
import { normalizeStoreUrl } from "./normalize-store-url";

describe("normalizeStoreUrl", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeStoreUrl("HTTPS://Shop.Example.COM/p/1")).toBe(
      "https://shop.example.com/p/1",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeStoreUrl("https://a.com/p#reviews")).toBe("https://a.com/p");
  });

  it("strips tracking params but keeps meaningful query", () => {
    expect(
      normalizeStoreUrl("https://a.com/p?id=9&utm_source=x&gclid=y&fbclid=z"),
    ).toBe("https://a.com/p?id=9");
  });

  it("trims a trailing slash except for the root path", () => {
    expect(normalizeStoreUrl("https://a.com/p/")).toBe("https://a.com/p");
    expect(normalizeStoreUrl("https://a.com/")).toBe("https://a.com/");
  });

  it("throws on a non-URL", () => {
    expect(() => normalizeStoreUrl("not a url")).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/normalize-store-url.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/domain/src/catalog/domain/normalize-store-url.ts

// Cache key normalizer: same product link pasted twice (differing case, fragment, or tracking
// params) maps to one key. Throws if the input is not a parseable URL.
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|mc_eid$|_ga$|ref$)/i;

export const normalizeStoreUrl = (input: string): string => {
  const url = new URL(input.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
};
```

- [ ] **Step 4: Export from barrel**

Add to `packages/domain/src/catalog/domain/index.ts`:

```typescript
export * from "./normalize-store-url";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/normalize-store-url.spec.ts`
Expected: PASS. (If the root-path case fails because `toString()` re-adds `/`, that is the intended `https://a.com/` output — the test expects it.)

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/catalog/domain/normalize-store-url.ts packages/domain/src/catalog/domain/normalize-store-url.spec.ts packages/domain/src/catalog/domain/index.ts
git commit -m "feat(catalog): add normalizeStoreUrl"
```

---

## Task 4: extractPuzzleDraft (tiered extraction)

**Files:**
- Create: `packages/domain/src/catalog/domain/extract-puzzle-draft.ts`
- Test: `packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Write the failing test**

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
    expect(d.title).toBe("Ravensburger Mountain Vista 1000 pieces");
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
        { ...empty, ogTitle: "OG Puzzle 500 stukjes", ogImages: ["https://img/og.jpg"] },
        SRC,
      ).title,
    ).toBe("OG Puzzle 500 stukjes");
    expect(
      extractPuzzleDraft({ ...empty, basicTitle: "Basic 750 Teile" }, SRC).title,
    ).toBe("Basic 750 Teile");
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

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/domain/src/catalog/domain/extract-puzzle-draft.ts
import type {
  JsonLdProduct,
  PuzzleImportDraft,
  RawProductPage,
} from "./puzzle-import-draft";

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
  const gtin13 = product?.gtin13 ?? (product?.gtin?.length === 13 ? product.gtin : undefined);
  const gtin12 = product?.gtin12 ?? (product?.gtin?.length === 12 ? product.gtin : undefined);
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

- [ ] **Step 4: Export from barrel**

Add to `packages/domain/src/catalog/domain/index.ts`:

```typescript
export * from "./extract-puzzle-draft";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/catalog/domain/extract-puzzle-draft.ts packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts packages/domain/src/catalog/domain/index.ts
git commit -m "feat(catalog): add tiered extractPuzzleDraft"
```

---

## Task 5: isPrivateIp (SSRF helper)

**Files:**
- Create: `packages/domain/src/catalog/domain/is-private-ip.ts`
- Test: `packages/domain/src/catalog/domain/is-private-ip.spec.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/src/catalog/domain/is-private-ip.spec.ts
import { describe, expect, it } from "vitest";
import { isPrivateIp } from "./is-private-ip";

describe("isPrivateIp", () => {
  it("flags loopback, RFC-1918, link-local, and unspecified IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.10.10",
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags IPv6 loopback, ULA, and link-local", () => {
    for (const ip of ["::1", "fc00::1", "fd12::34", "fe80::1", "::"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/is-private-ip.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/domain/src/catalog/domain/is-private-ip.ts

// SSRF guard for raw image fetches (the page fetch is guarded by ogie). Given a resolved IP
// literal, returns true if it points at loopback / private / link-local / unspecified space.
const ipv4Private = (ip: string): boolean => {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true; // unspecified, loopback
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local
  return false;
};

const ipv6Private = (raw: string): boolean => {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "::" || ip === "::1") return true; // unspecified, loopback
  if (ip.startsWith("fe80")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7 unique-local
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4Private(mapped[1]);
  return false;
};

export const isPrivateIp = (ip: string): boolean =>
  ip.includes(":") ? ipv6Private(ip) : ipv4Private(ip);
```

- [ ] **Step 4: Export from barrel**

Add to `packages/domain/src/catalog/domain/index.ts`:

```typescript
export * from "./is-private-ip";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm exec vitest run packages/domain/src/catalog/domain/is-private-ip.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/catalog/domain/is-private-ip.ts packages/domain/src/catalog/domain/is-private-ip.spec.ts packages/domain/src/catalog/domain/index.ts
git commit -m "feat(catalog): add isPrivateIp SSRF helper"
```

---

## Task 6: Outbound + inbound ports

**Files:**
- Create: `packages/domain/src/catalog/application/ports/out/store-page-fetcher.ts`
- Create: `packages/domain/src/catalog/application/ports/out/import-draft-cache.ts`
- Create: `packages/domain/src/catalog/application/ports/out/puzzle-match-lookup.ts`
- Create: `packages/domain/src/catalog/application/ports/in/import-puzzle-from-url.port.ts`
- Modify: `packages/domain/src/catalog/application/ports/out/index.ts`
- Modify: `packages/domain/src/catalog/application/ports/in/index.ts`

- [ ] **Step 1: Create the outbound ports**

```typescript
// packages/domain/src/catalog/application/ports/out/store-page-fetcher.ts
import { Result } from "../../../../shared-kernel";
import { RawProductPage, StorePageFetchError } from "../../../domain";

// Fetches a store page and returns scraper-agnostic metadata. The adapter (ogie) owns SSRF
// protection, timeout, and User-Agent for the PAGE fetch.
export interface StorePageFetcher {
  fetch(url: string): Promise<Result<RawProductPage, StorePageFetchError>>;
}
```

```typescript
// packages/domain/src/catalog/application/ports/out/import-draft-cache.ts
import { PuzzleImportDraft } from "../../../domain";

export interface CachedImportDraft {
  readonly draft: PuzzleImportDraft;
  readonly fetchedAt: Date;
}

// Keyed on a normalized URL so repeated pastes of the same link skip re-fetching.
export interface ImportDraftCache {
  get(normalizedUrl: string): Promise<CachedImportDraft | null>;
  put(normalizedUrl: string, draft: PuzzleImportDraft): Promise<void>;
}
```

```typescript
// packages/domain/src/catalog/application/ports/out/puzzle-match-lookup.ts

// A minimal summary of an existing catalog puzzle that matches an extracted barcode. Drives the
// "already on JigSwap - add to your collection" branch. `aggregateId` is the Catalog
// PuzzleDefinitionId the acquire-copy flow keys on; legacy rows may lack it.
export interface PuzzleMatch {
  readonly puzzleId: string;
  readonly aggregateId?: string;
  readonly title: string;
  readonly brand?: string;
  readonly pieceCount: number;
  readonly imageUrl?: string;
}

export interface PuzzleMatchLookup {
  findByBarcode(barcodes: {
    ean?: string;
    upc?: string;
  }): Promise<PuzzleMatch | null>;
}
```

- [ ] **Step 2: Create the inbound port**

```typescript
// packages/domain/src/catalog/application/ports/in/import-puzzle-from-url.port.ts
import { Result } from "../../../../shared-kernel";
import { PuzzleImportDraft, StorePageFetchError } from "../../../domain";
import { PuzzleMatch } from "../out/puzzle-match-lookup";

export interface ImportPuzzleFromUrlCommand {
  readonly url: string;
}

export interface PuzzleImportResult {
  readonly draft: PuzzleImportDraft;
  readonly match: PuzzleMatch | null;
}

export interface ImportPuzzleFromUrl {
  (
    cmd: ImportPuzzleFromUrlCommand,
  ): Promise<Result<PuzzleImportResult, StorePageFetchError>>;
}
```

- [ ] **Step 3: Export from barrels**

Add to `packages/domain/src/catalog/application/ports/out/index.ts`:

```typescript
export * from "./import-draft-cache";
export * from "./puzzle-match-lookup";
export * from "./store-page-fetcher";
```

Add to `packages/domain/src/catalog/application/ports/in/index.ts`:

```typescript
export * from "./import-puzzle-from-url.port";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec vitest run packages/domain`
Expected: PASS (existing suite compiles with new ports).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/catalog/application/ports
git commit -m "feat(catalog): add import ports (fetcher, cache, match lookup, inbound)"
```

---

## Task 7: Test doubles for the import ports

**Files:**
- Create: `packages/domain/src/catalog/application/testing/fake-store-page-fetcher.ts`
- Create: `packages/domain/src/catalog/application/testing/in-memory-import-draft-cache.ts`
- Create: `packages/domain/src/catalog/application/testing/fake-puzzle-match-lookup.ts`
- Modify: `packages/domain/src/catalog/application/testing/index.ts`

- [ ] **Step 1: Create the fakes**

```typescript
// packages/domain/src/catalog/application/testing/fake-store-page-fetcher.ts
import { err, ok, Result } from "../../../shared-kernel";
import { RawProductPage, StorePageFetchError } from "../../domain";
import { StorePageFetcher } from "../ports/out/store-page-fetcher";

export class FakeStorePageFetcher implements StorePageFetcher {
  public calls: string[] = [];
  private result: Result<RawProductPage, StorePageFetchError> = ok({
    ogImages: [],
    jsonLdProducts: [],
  });

  seedPage(page: RawProductPage): void {
    this.result = ok(page);
  }
  seedError(error: StorePageFetchError): void {
    this.result = err(error);
  }

  async fetch(url: string): Promise<Result<RawProductPage, StorePageFetchError>> {
    this.calls.push(url);
    return this.result;
  }
}
```

```typescript
// packages/domain/src/catalog/application/testing/in-memory-import-draft-cache.ts
import { PuzzleImportDraft } from "../../domain";
import { CachedImportDraft, ImportDraftCache } from "../ports/out/import-draft-cache";

export class InMemoryImportDraftCache implements ImportDraftCache {
  private store = new Map<string, CachedImportDraft>();

  seed(url: string, draft: PuzzleImportDraft, fetchedAt: Date): void {
    this.store.set(url, { draft, fetchedAt });
  }

  async get(normalizedUrl: string): Promise<CachedImportDraft | null> {
    return this.store.get(normalizedUrl) ?? null;
  }
  async put(normalizedUrl: string, draft: PuzzleImportDraft): Promise<void> {
    this.store.set(normalizedUrl, { draft, fetchedAt: new Date() });
  }
}
```

```typescript
// packages/domain/src/catalog/application/testing/fake-puzzle-match-lookup.ts
import { PuzzleMatch, PuzzleMatchLookup } from "../ports/out/puzzle-match-lookup";

export class FakePuzzleMatchLookup implements PuzzleMatchLookup {
  public calls: Array<{ ean?: string; upc?: string }> = [];
  private match: PuzzleMatch | null = null;

  seedMatch(match: PuzzleMatch | null): void {
    this.match = match;
  }

  async findByBarcode(barcodes: { ean?: string; upc?: string }): Promise<PuzzleMatch | null> {
    this.calls.push(barcodes);
    return this.match;
  }
}
```

- [ ] **Step 2: Export from the testing barrel**

Add to `packages/domain/src/catalog/application/testing/index.ts`:

```typescript
export * from "./fake-puzzle-match-lookup";
export * from "./fake-store-page-fetcher";
export * from "./in-memory-import-draft-cache";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec vitest run packages/domain`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/catalog/application/testing
git commit -m "test(catalog): add fakes for import ports"
```

---

## Task 8: makeImportPuzzleFromUrl use case

**Files:**
- Create: `packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.ts`
- Test: `packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.spec.ts`
- Modify: `packages/domain/src/catalog/application/use-cases/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.spec.ts
import { beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "../../../shared-kernel";
import { StorePageFetchError } from "../../domain";
import {
  FakePuzzleMatchLookup,
  FakeStorePageFetcher,
  FixedClock,
  InMemoryImportDraftCache,
} from "../testing";
import { makeImportPuzzleFromUrl } from "./import-puzzle-from-url";

const NOW = new Date("2026-06-13T10:00:00Z");
const URL_IN = "https://Shop.Example.com/p/1?utm_source=x";
const NORMALIZED = "https://shop.example.com/p/1";

describe("makeImportPuzzleFromUrl", () => {
  let fetcher: FakeStorePageFetcher;
  let cache: InMemoryImportDraftCache;
  let lookup: FakePuzzleMatchLookup;

  const run = () =>
    makeImportPuzzleFromUrl({
      fetcher,
      cache,
      lookup,
      clock: new FixedClock(NOW),
    });

  beforeEach(() => {
    fetcher = new FakeStorePageFetcher();
    cache = new InMemoryImportDraftCache();
    lookup = new FakePuzzleMatchLookup();
  });

  it("fetches, extracts a draft, caches under the normalized url, and looks up a match", async () => {
    fetcher.seedPage({
      ogImages: [],
      jsonLdProducts: [{ name: "Puzzle 1000 pieces", gtin13: "4005556150007" }],
    });
    const result = await run()({ url: URL_IN });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.draft.title).toBe("Puzzle 1000 pieces");
    expect(result.value.match).toBeNull();
    expect(fetcher.calls).toEqual([URL_IN]);
    expect(lookup.calls).toEqual([{ ean: "4005556150007", upc: undefined }]);
    expect(await cache.get(NORMALIZED)).not.toBeNull();
  });

  it("serves a fresh cached draft without fetching", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Cached", sourceUrl: NORMALIZED },
      new Date(NOW.getTime() - 1000),
    );
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Cached");
    expect(fetcher.calls).toEqual([]);
  });

  it("re-fetches when the cached draft is older than the TTL", async () => {
    cache.seed(
      NORMALIZED,
      { title: "Stale", sourceUrl: NORMALIZED },
      new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
    );
    fetcher.seedPage({ ogImages: [], jsonLdProducts: [{ name: "Fresh" }] });
    const result = await run()({ url: URL_IN });
    expect(isOk(result) && result.value.draft.title).toBe("Fresh");
    expect(fetcher.calls).toEqual([URL_IN]);
  });

  it("propagates a fetch error", async () => {
    fetcher.seedError(StorePageFetchError.timeout(URL_IN));
    const result = await run()({ url: URL_IN });
    expect(isErr(result) && result.error.code).toBe("Timeout");
  });

  it("returns InvalidUrl for an unparseable url without fetching", async () => {
    const result = await run()({ url: "not a url" });
    expect(isErr(result) && result.error.code).toBe("InvalidUrl");
    expect(fetcher.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.ts
import { Clock, err, ok } from "../../../shared-kernel";
import {
  extractPuzzleDraft,
  normalizeStoreUrl,
  PuzzleImportDraft,
  StorePageFetchError,
} from "../../domain";
import { ImportDraftCache } from "../ports/out/import-draft-cache";
import { PuzzleMatchLookup } from "../ports/out/puzzle-match-lookup";
import { StorePageFetcher } from "../ports/out/store-page-fetcher";
import { ImportPuzzleFromUrl } from "../ports/in/import-puzzle-from-url.port";

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
    if (cached && deps.clock.now().getTime() - cached.fetchedAt.getTime() < ttl) {
      draft = cached.draft;
    } else {
      const fetched = await deps.fetcher.fetch(cmd.url);
      if (fetched.isErr) return err(fetched.error);
      draft = extractPuzzleDraft(fetched.value, cmd.url);
      await deps.cache.put(normalized, draft);
    }

    const match = await deps.lookup.findByBarcode({
      ean: draft.ean,
      upc: draft.upc,
    });
    return ok({ draft, match });
  };
```

Confirm `Clock` and `ok/err` are exported from `../../../shared-kernel` (they are — `submit-puzzle-definition.ts` imports `Clock`, `err`, `ok` from there).

- [ ] **Step 4: Export from barrel**

Add to `packages/domain/src/catalog/application/use-cases/index.ts`:

```typescript
export * from "./import-puzzle-from-url";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm exec vitest run packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.spec.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Run the whole domain suite**

Run: `pnpm exec vitest run packages/domain`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.ts packages/domain/src/catalog/application/use-cases/import-puzzle-from-url.spec.ts packages/domain/src/catalog/application/use-cases/index.ts
git commit -m "feat(catalog): add makeImportPuzzleFromUrl use case"
```

---

## Task 9: Add ogie + puzzleImportCache table

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @jigswap/backend add ogie`
Expected: `ogie` appears in `packages/backend/package.json` dependencies.

- [ ] **Step 2: Inspect ogie's runtime shape (informs Task 12)**

Run: `node -e "const o=require('ogie'); console.log(Object.keys(o))"`
Expected: includes `extract` and `extractFromHtml`. Also run `find node_modules/ogie -name '*.d.ts'` and read the result types (`ExtractResult`, the `data.og/twitter/basic/jsonLd` shape) — note the exact `jsonLd` field name and image shape for the adapter.

- [ ] **Step 3: Add the cache table**

In `packages/backend/convex/schema.ts`, inside the `defineSchema({ ... })` object (place it after the `puzzles` table block), add:

```typescript
  // Cache of scraped store pages, keyed on a normalized URL, so repeated pastes of the same link
  // skip re-fetching. TTL is enforced at read time in the extract action (7 days).
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
  }).index("by_url", ["normalizedUrl"]),
```

- [ ] **Step 4: Regenerate Convex types**

Run: `pnpm --filter @jigswap/backend exec convex codegen`
Expected: `packages/backend/convex/_generated` updates; `puzzleImportCache` available in `Doc`/`dataModel`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/convex/schema.ts packages/backend/convex/_generated pnpm-lock.yaml
git commit -m "feat(backend): add ogie dep and puzzleImportCache table"
```

---

## Task 10: importCache internal functions

**Files:**
- Create: `packages/backend/convex/catalog/importCache.ts`
- Test: `packages/backend/convex/catalog/importCache.test.ts`

- [ ] **Step 1: Implement**

```typescript
// packages/backend/convex/catalog/importCache.ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

// Shared validator for the cached draft; mirrors the domain PuzzleImportDraft shape.
const draftValidator = v.object({
  title: v.string(),
  brand: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  description: v.optional(v.string()),
  ean: v.optional(v.string()),
  upc: v.optional(v.string()),
  pieceCount: v.optional(v.number()),
  sourceUrl: v.string(),
});

export const getCachedImport = internalQuery({
  args: { normalizedUrl: v.string() },
  handler: async (ctx, { normalizedUrl }) =>
    ctx.db
      .query("puzzleImportCache")
      .withIndex("by_url", (q) => q.eq("normalizedUrl", normalizedUrl))
      .unique(),
});

export const putCachedImport = internalMutation({
  args: { normalizedUrl: v.string(), draft: draftValidator },
  handler: async (ctx, { normalizedUrl, draft }) => {
    const existing = await ctx.db
      .query("puzzleImportCache")
      .withIndex("by_url", (q) => q.eq("normalizedUrl", normalizedUrl))
      .unique();
    const fetchedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { draft, fetchedAt });
    else await ctx.db.insert("puzzleImportCache", { normalizedUrl, draft, fetchedAt });
  },
});
```

- [ ] **Step 2: Write the convex-test**

```typescript
// packages/backend/convex/catalog/importCache.test.ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.{js,ts}", "!../**/*.test.{js,ts}"]);
const draft = { title: "Cached", sourceUrl: "https://a.com/p" };

describe("catalog.importCache", () => {
  test("put then get round-trips a draft and upserts", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.catalog.importCache.putCachedImport, {
      normalizedUrl: "https://a.com/p",
      draft,
    });
    const first = await t.query(internal.catalog.importCache.getCachedImport, {
      normalizedUrl: "https://a.com/p",
    });
    expect(first?.draft.title).toBe("Cached");

    await t.mutation(internal.catalog.importCache.putCachedImport, {
      normalizedUrl: "https://a.com/p",
      draft: { ...draft, title: "Updated" },
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("puzzleImportCache").collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0].draft.title).toBe("Updated");
  });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `pnpm exec vitest run packages/backend/convex/catalog/importCache.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/catalog/importCache.ts packages/backend/convex/catalog/importCache.test.ts
git commit -m "feat(backend): add puzzle import cache internal functions"
```

---

## Task 11: findPuzzleByBarcode internal query

**Files:**
- Create: `packages/backend/convex/catalog/findPuzzleByBarcode.ts`
- Test: `packages/backend/convex/catalog/findPuzzleByBarcode.test.ts`

- [ ] **Step 1: Implement**

```typescript
// packages/backend/convex/catalog/findPuzzleByBarcode.ts
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";

// Surfaces an existing APPROVED catalog puzzle carrying the extracted EAN/UPC, to drive the
// "already on JigSwap" dedup branch. Approved-only by design: never leak another member's
// unapproved submission. A rare pending-collision is caught later by the submit barcode rule.
export const findPuzzleByBarcode = internalQuery({
  args: { ean: v.optional(v.string()), upc: v.optional(v.string()) },
  handler: async (ctx, { ean, upc }) => {
    const candidates: Doc<"puzzles">[] = [];
    if (ean) {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_ean", (q) => q.eq("ean", ean))
        .first();
      if (row) candidates.push(row);
    }
    if (upc) {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_upc", (q) => q.eq("upc", upc))
        .first();
      if (row) candidates.push(row);
    }
    const match = candidates.find((p) => p.status === "approved");
    if (!match) return null;

    return {
      puzzleId: match._id as string,
      aggregateId: match.aggregateId,
      title: match.title,
      brand: match.brand,
      pieceCount: match.pieceCount,
      imageUrl: match.image ? (await ctx.storage.getUrl(match.image)) ?? undefined : undefined,
    };
  },
});
```

- [ ] **Step 2: Write the convex-test**

```typescript
// packages/backend/convex/catalog/findPuzzleByBarcode.test.ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob(["../**/*.{js,ts}", "!../**/*.test.{js,ts}"]);

const seedPuzzle = (extra: Record<string, unknown>) => ({
  title: "Mountain Vista",
  pieceCount: 1000,
  status: "approved" as const,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe("catalog.findPuzzleByBarcode", () => {
  test("returns an approved match by EAN", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c1", email: "a@b.c", name: "A", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ ean: "4005556150007", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      ean: "4005556150007",
    });
    expect(match?.title).toBe("Mountain Vista");
  });

  test("ignores pending matches and returns null", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const submittedBy = await ctx.db.insert("users", {
        clerkId: "c2", email: "d@e.f", name: "B", isActive: true, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("puzzles", seedPuzzle({ ean: "111", status: "pending", submittedBy }));
    });
    const match = await t.query(internal.catalog.findPuzzleByBarcode.findPuzzleByBarcode, {
      ean: "111",
    });
    expect(match).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `pnpm exec vitest run packages/backend/convex/catalog/findPuzzleByBarcode.test.ts`
Expected: PASS. (If the `users` insert shape mismatches the schema, adjust the seed fields to satisfy required columns — check `schema.ts` `users`.)

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/catalog/findPuzzleByBarcode.ts packages/backend/convex/catalog/findPuzzleByBarcode.test.ts
git commit -m "feat(backend): add findPuzzleByBarcode dedup query"
```

---

## Task 12: ogie page-fetcher adapter

**Files:**
- Create: `packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts`

> Note: this module imports `ogie` (a Node package). It is imported ONLY by the `"use node"`
> action in Task 13, so its module graph lands in Convex's Node runtime. Do not import it from
> any default-runtime (non-node) Convex module.

- [ ] **Step 1: Confirm ogie's result field names**

Using the d.ts read in Task 9 Step 2 (and optionally the `dobroslavradosavljevic/ogie` agent skill), confirm: `extract(url, opts)` returns `{ success: boolean; data?: {...}; error?: { code: string } }`; `data.og.title`, `data.og.description`, `data.og.images: { url: string }[]`, `data.basic.title`, `data.basic.description`, and the JSON-LD collection field name. The implementation below assumes `data.jsonLd` is an array of raw JSON-LD objects; if the installed version names it differently or nests under `data.structured`, adjust the two referenced accessors (`data.jsonLd`, the og image `.url`) to match — everything else is shape-independent.

- [ ] **Step 2: Implement**

```typescript
// packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts
import { extract } from "ogie";
import {
  err,
  ok,
  type JsonLdProduct,
  type RawProductPage,
  type StorePageFetcher,
  StorePageFetchError,
} from "@jigswap/domain";

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

const flattenBrand = (brand: unknown): string | undefined => {
  if (typeof brand === "string") return brand;
  if (brand && typeof brand === "object" && "name" in brand) {
    const name = (brand as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

// Pull every JSON-LD node whose @type is (or includes) "Product" and project the fields we use.
const toJsonLdProducts = (jsonLd: unknown): JsonLdProduct[] => {
  const nodes = asArray(jsonLd).flatMap((node) => {
    const graph = (node as { "@graph"?: unknown })?.["@graph"];
    return graph ? asArray(graph) : [node];
  });
  return nodes
    .filter((node): node is Record<string, unknown> => {
      const type = (node as { "@type"?: unknown })?.["@type"];
      return asArray(type).includes("Product");
    })
    .map((node) => ({
      name: typeof node.name === "string" ? node.name : undefined,
      brand: flattenBrand(node.brand),
      description: typeof node.description === "string" ? node.description : undefined,
      image: (Array.isArray(node.image) ? node.image : node.image) as
        | string
        | string[]
        | undefined,
      gtin13: typeof node.gtin13 === "string" ? node.gtin13 : undefined,
      gtin12: typeof node.gtin12 === "string" ? node.gtin12 : undefined,
      gtin: typeof node.gtin === "string" ? node.gtin : undefined,
    }));
};

const mapError = (code: string | undefined, url: string): StorePageFetchError => {
  switch (code) {
    case "INVALID_URL":
      return StorePageFetchError.invalidUrl(url);
    case "BLOCKED":
    case "SSRF_BLOCKED":
      return StorePageFetchError.blocked(url);
    case "TIMEOUT":
      return StorePageFetchError.timeout(url);
    case "NOT_FOUND":
    case "HTTP_404":
      return StorePageFetchError.notFound(url);
    default:
      return StorePageFetchError.fetchFailed(code ?? "unknown");
  }
};

export const ogieStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    let result;
    try {
      result = await extract(url, {
        timeout: 10000,
        userAgent: "JigSwapBot/1.0",
        maxRedirects: 5,
      });
    } catch (e) {
      return err(StorePageFetchError.fetchFailed(e instanceof Error ? e.message : String(e)));
    }

    if (!result.success || !result.data) {
      return err(mapError(result.error?.code, url));
    }

    const data = result.data as {
      og?: { title?: string; description?: string; images?: Array<{ url?: string }> };
      basic?: { title?: string; description?: string };
      jsonLd?: unknown;
    };

    const page: RawProductPage = {
      ogTitle: data.og?.title,
      ogDescription: data.og?.description,
      ogImages: (data.og?.images ?? [])
        .map((img) => img?.url)
        .filter((u): u is string => typeof u === "string"),
      basicTitle: data.basic?.title,
      basicDescription: data.basic?.description,
      jsonLdProducts: toJsonLdProducts(data.jsonLd),
    };
    return ok(page);
  },
};
```

- [ ] **Step 3: Typecheck the backend package**

Run: `pnpm --filter @jigswap/backend exec tsc --noEmit` (or `pnpm exec vitest run packages/backend` to compile on collect)
Expected: no type errors in this file.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts
git commit -m "feat(backend): add ogie store-page fetcher adapter"
```

---

## Task 13: extractFromUrl action

**Files:**
- Create: `packages/backend/convex/catalog/extractFromUrl.ts`

- [ ] **Step 1: Implement**

```typescript
// packages/backend/convex/catalog/extractFromUrl.ts
"use node";
import {
  type CachedImportDraft,
  type ImportDraftCache,
  makeImportPuzzleFromUrl,
  type PuzzleMatchLookup,
} from "@jigswap/domain";
import { v } from "convex/values";
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
  },
});
```

- [ ] **Step 2: Regenerate Convex types**

Run: `pnpm --filter @jigswap/backend exec convex codegen`
Expected: `api.catalog.extractFromUrl.extractFromUrl` exists in generated api.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec vitest run packages/backend`
Expected: existing backend suite passes; the new action compiles.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/catalog/extractFromUrl.ts packages/backend/convex/_generated
git commit -m "feat(backend): add extractFromUrl node action"
```

---

## Task 14: importPuzzleImage action

**Files:**
- Create: `packages/backend/convex/catalog/importPuzzleImage.ts`

- [ ] **Step 1: Implement**

```typescript
// packages/backend/convex/catalog/importPuzzleImage.ts
"use node";
import { isPrivateIp } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { lookup as dnsLookup } from "node:dns/promises";
import { action } from "../_generated/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Public Node action: fetch a remote image (no hotlinking) and store it in Convex storage.
// Carries its OWN SSRF guard — ogie protects only the page fetch, not this raw image fetch.
export const importPuzzleImage = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<string> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ConvexError("Invalid image URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConvexError("Unsupported image protocol");
    }

    const addresses = await dnsLookup(parsed.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
      throw new ConvexError("Refused to fetch image (blocked address)");
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "JigSwapBot/1.0" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) throw new ConvexError(`Image fetch failed: ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new ConvexError("URL did not return an image");
    }
    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BYTES) throw new ConvexError("Image too large");

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new ConvexError("Image too large");

    const storageId = await ctx.storage.store(new Blob([buffer], { type: contentType }));
    return storageId;
  },
});
```

- [ ] **Step 2: Regenerate Convex types**

Run: `pnpm --filter @jigswap/backend exec convex codegen`
Expected: `api.catalog.importPuzzleImage.importPuzzleImage` exists.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec vitest run packages/backend`
Expected: compiles; existing suite green.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/catalog/importPuzzleImage.ts packages/backend/convex/_generated
git commit -m "feat(backend): add importPuzzleImage node action with SSRF guard"
```

---

## Task 15: Expose gateway operations

**Files:**
- Modify: `packages/gateway/src/operations.ts`

- [ ] **Step 1: Add the two catalog entries**

In `packages/gateway/src/operations.ts`, inside `gateway.catalog`, add (next to `createPuzzle`):

```typescript
    extractPuzzleFromUrl: api.catalog.extractFromUrl.extractFromUrl,
    importPuzzleImage: api.catalog.importPuzzleImage.importPuzzleImage,
```

- [ ] **Step 2: Typecheck the gateway**

Run: `pnpm --filter @jigswap/gateway exec tsc --noEmit`
Expected: no errors (generated api now includes both functions).

- [ ] **Step 3: Commit**

```bash
git add packages/gateway/src/operations.ts
git commit -m "feat(gateway): expose extractPuzzleFromUrl + importPuzzleImage"
```

---

## Task 16: draft→form-defaults mapper

**Files:**
- Create: `apps/web/src/components/puzzle-import/draft-to-form-defaults.ts`
- Test: `apps/web/src/components/puzzle-import/draft-to-form-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/components/puzzle-import/draft-to-form-defaults.test.ts
import { describe, expect, it } from "vitest";
import { draftToFormDefaults, type ImportedDraft } from "./draft-to-form-defaults";

const base: ImportedDraft = { title: "Puzzle 1000 pieces", sourceUrl: "https://a.com/p" };

describe("draftToFormDefaults", () => {
  it("maps present fields and blanks the rest to form-safe defaults", () => {
    const d = draftToFormDefaults({
      ...base,
      brand: "Ravensburger",
      description: "Nice",
      ean: "4005556150007",
      pieceCount: 1000,
    });
    expect(d.title).toBe("Puzzle 1000 pieces");
    expect(d.brand).toBe("Ravensburger");
    expect(d.description).toBe("Nice");
    expect(d.ean).toBe("4005556150007");
    expect(d.pieceCount).toBe(1000);
    expect(d.tags).toEqual([]);
    expect(d.image).toBeUndefined();
  });

  it("uses empty strings for missing optional text and leaves pieceCount undefined", () => {
    const d = draftToFormDefaults(base);
    expect(d.brand).toBe("");
    expect(d.ean).toBe("");
    expect(d.pieceCount).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run apps/web/src/components/puzzle-import/draft-to-form-defaults.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/components/puzzle-import/draft-to-form-defaults.ts
import type { PuzzleFormData } from "@/components/forms/puzzle-form";

// The draft fields returned by the extractFromUrl action (mirrors domain PuzzleImportDraft).
export interface ImportedDraft {
  title: string;
  brand?: string;
  imageUrl?: string;
  description?: string;
  ean?: string;
  upc?: string;
  pieceCount?: number;
  sourceUrl: string;
}

// Map a scraped draft onto PuzzleForm default values. pieceCount stays undefined when unknown so
// the user must confirm it (the form requires >= 1). The remote image is handled separately by
// the page on confirm (importPuzzleImage); the form `image` field stays empty.
export const draftToFormDefaults = (draft: ImportedDraft): PuzzleFormData => ({
  title: draft.title ?? "",
  description: draft.description ?? "",
  brand: draft.brand ?? "",
  artist: "",
  series: "",
  pieceCount: draft.pieceCount as unknown as number,
  difficulty: undefined,
  category: undefined,
  tags: [],
  ean: draft.ean ?? "",
  upc: draft.upc ?? "",
  modelNumber: "",
  dimensions: undefined,
  shape: undefined,
  image: undefined,
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec vitest run apps/web/src/components/puzzle-import/draft-to-form-defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/puzzle-import/draft-to-form-defaults.ts apps/web/src/components/puzzle-import/draft-to-form-defaults.test.ts
git commit -m "feat(web): add draft-to-form-defaults mapper"
```

---

## Task 17: usePuzzleImport hook

**Files:**
- Create: `apps/web/src/components/puzzle-import/use-puzzle-import.ts`

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/components/puzzle-import/use-puzzle-import.ts
import { gateway } from "@/gateway";
import { useAction } from "convex/react";
import { useState } from "react";
import type { ImportedDraft } from "./draft-to-form-defaults";

export interface ImportedMatch {
  puzzleId: string;
  aggregateId?: string;
  title: string;
  brand?: string;
  pieceCount: number;
  imageUrl?: string;
}

export type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; draft: ImportedDraft; match: ImportedMatch | null };

export const usePuzzleImport = () => {
  const extract = useAction(gateway.catalog.extractPuzzleFromUrl);
  const [state, setState] = useState<ImportState>({ status: "idle" });

  const run = async (url: string) => {
    setState({ status: "loading" });
    try {
      const result = await extract({ url });
      if (!result.ok) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", draft: result.draft, match: result.match });
    } catch {
      setState({ status: "error" });
    }
  };

  const reset = () => setState({ status: "idle" });

  return { state, run, reset };
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit` (or the web app's typecheck script; if the package name differs, use `pnpm --filter ./apps/web exec tsc --noEmit`)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/puzzle-import/use-puzzle-import.ts
git commit -m "feat(web): add usePuzzleImport hook"
```

---

## Task 18: i18n keys

**Files:**
- Modify: `apps/web/locales/en.json`
- Modify: `apps/web/locales/nl.json`
- Modify: `apps/web/locales/source.json`

- [ ] **Step 1: Add keys to the `puzzles` namespace in each file**

`en.json` — add these entries to the `"puzzles"` object:

```json
"importFromUrl": "Import from a store link",
"importUrlPlaceholder": "Paste a puzzle product URL",
"importFetch": "Fetch details",
"importFetching": "Fetching…",
"importFailed": "Couldn't read that page — add the details manually.",
"importAlreadyExists": "This puzzle is already on JigSwap — add it to your collection?",
"importAddToCollection": "Add to collection",
"importCreateAnyway": "Create new anyway"
```

`nl.json` — add to its `"puzzles"` object:

```json
"importFromUrl": "Importeer via een winkellink",
"importUrlPlaceholder": "Plak een product-URL van een puzzel",
"importFetch": "Gegevens ophalen",
"importFetching": "Bezig met ophalen…",
"importFailed": "Kon die pagina niet lezen — vul de gegevens handmatig in.",
"importAlreadyExists": "Deze puzzel staat al op JigSwap — toevoegen aan je collectie?",
"importAddToCollection": "Aan collectie toevoegen",
"importCreateAnyway": "Toch nieuw aanmaken"
```

`source.json` — mirror the `en.json` entries (same keys/values) in its `"puzzles"` object.

- [ ] **Step 2: Validate JSON**

Run: `node -e "['en','nl','source'].forEach(f=>require('./apps/web/locales/'+f+'.json'))"`
Expected: no parse error.

- [ ] **Step 3: Commit**

```bash
git add apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git commit -m "i18n: add puzzle import strings (en, nl, source)"
```

---

## Task 19: PuzzleImportBar component

**Files:**
- Create: `apps/web/src/components/puzzle-import/puzzle-import-bar.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/puzzle-import/puzzle-import-bar.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { ImportedDraft } from "./draft-to-form-defaults";
import { type ImportedMatch, usePuzzleImport } from "./use-puzzle-import";

interface PuzzleImportBarProps {
  onDraft: (draft: ImportedDraft) => void;
  onMatch: (match: ImportedMatch) => void;
}

// Paste-a-store-link bar shown above the add-puzzle form. On a successful extraction it either
// hands the draft to the host page (prefill) or surfaces an existing-puzzle match (dedup).
export const PuzzleImportBar = ({ onDraft, onMatch }: PuzzleImportBarProps) => {
  const t = useTranslations("puzzles");
  const { state, run } = usePuzzleImport();
  const [url, setUrl] = useState("");

  const submit = async () => {
    if (!url.trim()) return;
    await run(url.trim());
  };

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
      <label className="text-sm font-medium">{t("importFromUrl")}</label>
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("importUrlPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? t("importFetching") : t("importFetch")}
        </Button>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-muted-foreground">{t("importFailed")}</p>
      )}

      {state.status === "ready" && state.match && (
        <div className="flex items-center justify-between gap-2 rounded border bg-background p-2">
          <span className="text-sm">{t("importAlreadyExists")}</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => onMatch(state.match!)}>
              {t("importAddToCollection")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onDraft(state.draft);
                toast.message(state.draft.title || t("importFromUrl"));
              }}
            >
              {t("importCreateAnyway")}
            </Button>
          </div>
        </div>
      )}

      {state.status === "ready" && !state.match && (
        <ReadyPreview draft={state.draft} onUse={() => onDraft(state.draft)} />
      )}
    </div>
  );
};

const ReadyPreview = ({
  draft,
  onUse,
}: {
  draft: ImportedDraft;
  onUse: () => void;
}) => {
  // Prefill immediately on a clean (no-match) extraction.
  onUse();
  return (
    <div className="flex items-center gap-3 rounded border bg-background p-2">
      {draft.imageUrl && (
        <img
          src={draft.imageUrl}
          alt={draft.title}
          className="h-12 w-12 rounded object-cover"
        />
      )}
      <div className="text-sm">
        <div className="font-medium">{draft.title}</div>
        {draft.brand && <div className="text-muted-foreground">{draft.brand}</div>}
      </div>
    </div>
  );
};
```

> Calling `onUse()` during render is acceptable here because the host stores defaults in state
> keyed by `sourceUrl` (Task 20) and ignores repeats for the same draft. If the project's lint
> forbids side effects in render, move `onUse()` into a `useEffect` keyed on `draft.sourceUrl`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors. (Verify `@/components/ui/input` and `@/components/ui/button` exist — both are used elsewhere in the repo.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/puzzle-import/puzzle-import-bar.tsx
git commit -m "feat(web): add PuzzleImportBar component"
```

---

## Task 20: Integrate into /puzzles/add

**Files:**
- Modify: `apps/web/src/routes/_dashboard/puzzles/add.tsx`

- [ ] **Step 1: Add imports + import state**

At the top of `AddPuzzlePage`, add the imports and state. Replace the component's top section so it reads:

```tsx
import { PuzzleImportBar } from "@/components/puzzle-import/puzzle-import-bar";
import { draftToFormDefaults, type ImportedDraft } from "@/components/puzzle-import/draft-to-form-defaults";
import { useAction, useMutation } from "convex/react";
import { useState, useTransition } from "react";
// ...existing imports...

function AddPuzzlePage() {
  const router = useRouter();
  const createPuzzle = useMutation(gateway.catalog.createPuzzle);
  const generateUploadUrl = useMutation(gateway.library.generateUploadUrl);
  const importImage = useAction(gateway.catalog.importPuzzleImage);
  const t = useTranslations("puzzles");
  const [isPending, startTransition] = useTransition();

  // Imported draft state: defaults to prefill the form (re-keyed to remount) and the remote image
  // URL to fetch+store on confirm if the user didn't pick their own file.
  const [defaults, setDefaults] = useState<PuzzleFormData | undefined>(undefined);
  const [importKey, setImportKey] = useState(0);
  const [importedImageUrl, setImportedImageUrl] = useState<string | undefined>(undefined);

  const applyDraft = (draft: ImportedDraft) => {
    setDefaults(draftToFormDefaults(draft));
    setImportedImageUrl(draft.imageUrl);
    setImportKey((k) => k + 1);
  };
```

- [ ] **Step 2: Update `handleSubmit` to resolve the imported image**

Replace the `storageId` IIFE in `handleSubmit` with:

```tsx
        const storageId = await (async () => {
          if (data.image instanceof File) {
            const imageUrl = await generateUploadUrl();
            const result = await fetch(imageUrl, {
              method: "POST",
              headers: { "Content-Type": data.image.type },
              body: data.image,
            });
            const { storageId } = await result.json();
            return storageId;
          }
          // No user-picked file: if the draft carried a remote image, fetch+store it server-side.
          if (importedImageUrl) {
            try {
              return await importImage({ url: importedImageUrl });
            } catch (error) {
              console.error("Imported image failed; creating without it:", error);
              return undefined;
            }
          }
          return undefined;
        })();
```

- [ ] **Step 3: Render the import bar + key the form**

Replace the `<PuzzleForm ...>` block in the returned JSX with:

```tsx
        <PuzzleImportBar
          onDraft={applyDraft}
          onMatch={(match) =>
            router.push(`/my-puzzles/add?puzzleId=${match.puzzleId}`)
          }
        />

        <PuzzleForm
          key={importKey}
          onSubmit={handleSubmit}
          onCancel={() => router.push("/puzzles")}
          pending={isPending}
          defaultValues={defaults}
        >
          <PuzzleForm.Content />
          <PuzzleForm.Actions />
        </PuzzleForm>
```

Ensure `PuzzleFormData` is imported (it already is: `import { PuzzleForm, PuzzleFormData } from "@/components/forms/puzzle-form";`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/puzzles/add.tsx
git commit -m "feat(web): wire puzzle import into /puzzles/add"
```

---

## Task 21: Integrate into /my-puzzles/add

**Files:**
- Modify: `apps/web/src/routes/_dashboard/my-puzzles/add.tsx`

- [ ] **Step 1: Add imports, actions, and draft state**

Add near the other hooks in `AddPuzzlePage`:

```tsx
import { PuzzleImportBar } from "@/components/puzzle-import/puzzle-import-bar";
import { draftToFormDefaults, type ImportedDraft } from "@/components/puzzle-import/draft-to-form-defaults";
import { useAction } from "convex/react";
// ...

  const importImage = useAction(gateway.catalog.importPuzzleImage);
  const [createDefaults, setCreateDefaults] = useState<PuzzleFormData | undefined>(undefined);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [importedImageUrl, setImportedImageUrl] = useState<string | undefined>(undefined);

  const applyImportedDraft = (draft: ImportedDraft) => {
    setCreateDefaults(draftToFormDefaults(draft));
    setImportedImageUrl(draft.imageUrl);
    setCreateFormKey((k) => k + 1);
    setCreatePuzzleOpen(true);
  };
```

Add `PuzzleFormData` to the existing puzzle-form import:

```tsx
import { PuzzleForm, PuzzleFormData } from "@/components/forms/puzzle-form";
```

- [ ] **Step 2: Resolve imported image in `handleCreatePuzzle`**

Replace the image block in `handleCreatePuzzle` with:

```tsx
      let imageId: Id<"_storage"> | undefined;
      if (data.image instanceof File) {
        const uploadUrl = await generateUploadUrl();
        const uploadResult = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": data.image.type },
          body: data.image,
        });
        if (!uploadResult.ok) throw new Error("Failed to upload image");
        imageId = await uploadResult.json();
      } else if (importedImageUrl) {
        try {
          imageId = (await importImage({ url: importedImageUrl })) as Id<"_storage">;
        } catch (error) {
          console.error("Imported image failed; creating without it:", error);
        }
      }
```

- [ ] **Step 3: Render the import bar + prefill the create dialog form**

Add the bar above the search combobox `<div className="space-y-2">` (inside the first `CardContent`):

```tsx
            <PuzzleImportBar
              onDraft={applyImportedDraft}
              onMatch={(match) =>
                handlePuzzleSelect({
                  _id: match.puzzleId,
                  aggregateId: match.aggregateId,
                  title: match.title,
                  brand: match.brand,
                  pieceCount: match.pieceCount,
                  image: match.imageUrl ?? null,
                })
              }
            />
```

Then key + prefill the dialog's `<PuzzleForm>`:

```tsx
                              <PuzzleForm
                                key={createFormKey}
                                onSubmit={handleCreatePuzzle}
                                onCancel={() => setCreatePuzzleOpen(false)}
                                pending={isCreatingPuzzle}
                                defaultValues={createDefaults}
                              >
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors. (`handlePuzzleSelect` already accepts the `{ _id, aggregateId, title, brand, pieceCount, image }` shape.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/my-puzzles/add.tsx
git commit -m "feat(web): wire puzzle import into /my-puzzles/add"
```

---

## Task 22: Full verification

**Files:** none

- [ ] **Step 1: Regenerate Convex types (final)**

Run: `pnpm --filter @jigswap/backend exec convex codegen`
Expected: clean.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm exec vitest run packages/domain packages/backend apps/web`
Expected: all PASS, including the new domain, convex-test, and mapper tests.

- [ ] **Step 3: Typecheck every touched package**

Run: `pnpm -r exec tsc --noEmit` (or each: domain, backend, gateway, web)
Expected: no type errors.

- [ ] **Step 4: Lint (if configured)**

Run: `pnpm -r lint` (skip any package without a `lint` script)
Expected: clean, or only pre-existing warnings.

- [ ] **Step 5: Manual smoke test (Convex dev + web dev)**

Start Convex + web per the repo's dev scripts. In `/puzzles/add`, paste a real EU puzzle product URL (e.g. a Ravensburger or puzzle.nl product page). Verify: the form prefills title/brand/piece-count/EAN, the preview image shows, and on submit the puzzle is created with a stored image. Paste a URL whose EAN already exists → verify the "already on JigSwap" prompt links to `/my-puzzles/add?puzzleId=…`. Paste a junk/blocked URL → verify the graceful "add the details manually" message and a still-usable form.

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore: puzzle import from url - verification fixes"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** tiered extraction (T4), SSRF page (T12 via ogie) + image (T5/T14), fetch safety UA+timeout (T12/T14), EAN/UPC dedup (T11) + acquire-copy branch (T20/T21), server-side image store (T14), scrape cache (T9/T10/T8 TTL), graceful degradation (T13 discriminated result + T19 UI), reuse of submitPuzzleDefinition (T20/T21), shared import bar on both routes (T19–T21), gateway (T15), schema (T9), tests (T2–T8,T10,T11,T16). All spec sections map to a task.
- **Type consistency:** `PuzzleImportDraft`/`RawProductPage`/`JsonLdProduct` (T1) used identically in T4/T6/T8/T10; `StorePageFetchError` codes (T2) returned by use case (T8) and surfaced as `code` (T13); `PuzzleMatch` (T6) is the lookup return (T11) and the hook's `ImportedMatch` (T17); cache validator (T10) mirrors the draft object (T9).
- **Known approximation:** ogie's `data.jsonLd` field name + og-image shape are verified against the installed d.ts in T12 Step 1 before the adapter is finalized — the only network-coupled mapping, deliberately isolated behind the `StorePageFetcher` port.
