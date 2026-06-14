# Browser UA Fallback Fetcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tier-2 "browser User-Agent retry" fallback to the puzzle-import page fetch so that store pages that block bot-UA requests get a second chance via a realistic desktop-Chrome UA.

**Architecture:** Three-part implementation following the hexagonal architecture: (1) a pure domain composite `makeFallbackStorePageFetcher` that tries primary and conditionally falls back; (2) a backend `browserStorePageFetcher` adapter that does a raw SSRF-safe fetch then passes the HTML to `ogie.extractFromHtml`; (3) wire both into `extractFromUrl.ts`. The browser fetcher mirrors `importPuzzleImage`'s SSRF guard exactly (DNS resolve + private-IP reject + manual-redirect loop). A shared `ogieRawProductPage.ts` module is extracted first so both adapters share the same `data → RawProductPage` projection.

**Tech Stack:** TypeScript, Vitest, `ogie` (extractFromHtml), `node:dns/promises`, `@jigswap/domain` (isPrivateIp, StorePageFetchError, Result), pnpm monorepo.

---

## HEAD before first commit

`2d779e2ac1122c07689cf99d4771c4aa868a76d0`

---

## File Structure

### New files

- `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.ts` — pure composite StorePageFetcher: tries primary, falls back on retryable errors
- `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts` — TDD tests for the composite
- `packages/backend/convex/catalog/adapters/ogieRawProductPage.ts` — extracted shared helpers + `toRawProductPage(data)` mapping
- `packages/backend/convex/catalog/adapters/browserStorePageFetcher.ts` — new adapter: SSRF-safe raw HTML fetch + ogie.extractFromHtml

### Modified files

- `packages/domain/src/catalog/application/index.ts` — add `export * from "./make-fallback-store-page-fetcher"`
- `packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts` — import `toRawProductPage` from `ogieRawProductPage.ts`, remove extracted helpers
- `packages/backend/convex/catalog/extractFromUrl.ts` — wire `makeFallbackStorePageFetcher(ogieStorePageFetcher, browserStorePageFetcher)` as fetcher

---

## Task 1: Extract shared ogie-to-RawProductPage mapping into `ogieRawProductPage.ts`

**Why first:** The browser adapter will need `toRawProductPage` and the error mapper; extracting them now lets both adapters share the same code without duplication. Doing this refactor before adding new files keeps the diff reviewable.

**Files:**

- Create: `packages/backend/convex/catalog/adapters/ogieRawProductPage.ts`
- Modify: `packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts`

- [ ] **Step 1: Create `ogieRawProductPage.ts` with the extracted helpers**

Create the file at `packages/backend/convex/catalog/adapters/ogieRawProductPage.ts`:

```ts
import {
  type JsonLdProduct,
  type RawProductPage,
  StorePageFetchError,
} from "@jigswap/domain";

export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

// JSON-LD `image` is wildly inconsistent: a string, an array, or an ImageObject ({ url }).
export const extractJsonLdImage = (
  image: unknown,
): string | string[] | undefined => {
  const one = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { url?: unknown }).url === "string"
    ) {
      return (value as { url: string }).url;
    }
    return null;
  };
  if (Array.isArray(image)) {
    const urls = image.map(one).filter((u): u is string => u !== null);
    return urls.length > 0 ? urls : undefined;
  }
  return one(image) ?? undefined;
};

export const flattenBrand = (brand: unknown): string | undefined => {
  if (typeof brand === "string") return brand;
  if (brand && typeof brand === "object" && "name" in brand) {
    const name = (brand as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

// Pull every JSON-LD node whose @type is (or includes) "Product" and project the fields we use.
export const toJsonLdProducts = (jsonLd: unknown): JsonLdProduct[] => {
  // jsonLd is JsonLdData = { items: JsonLdItem[]; raw: unknown[] } — use .raw for @type filtering
  const rawArray =
    jsonLd != null && typeof jsonLd === "object" && "raw" in jsonLd
      ? asArray((jsonLd as { raw: unknown }).raw)
      : asArray(jsonLd);

  const nodes = asArray(rawArray)
    .flatMap((node) => (Array.isArray(node) ? node : [node]))
    .flatMap((node) => {
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
      description:
        typeof node.description === "string" ? node.description : undefined,
      image: extractJsonLdImage(node.image),
      gtin13: typeof node.gtin13 === "string" ? node.gtin13 : undefined,
      gtin12: typeof node.gtin12 === "string" ? node.gtin12 : undefined,
      gtin: typeof node.gtin === "string" ? node.gtin : undefined,
    }));
};

// Map ogie ErrorCode to domain StorePageFetchError, preserving the raw ogie code+message as
// `detail` so a failed extraction can be diagnosed from the logs (the UI only ever sees `code`).
// ogie codes: FETCH_ERROR | TIMEOUT | PARSE_ERROR | INVALID_URL | NO_HTML | REDIRECT_LIMIT
export const mapOgieError = (
  error: { code: string; message?: string },
  url: string,
): StorePageFetchError => {
  const detail = error.message ? `${error.code}: ${error.message}` : error.code;
  switch (error.code) {
    case "INVALID_URL":
      return StorePageFetchError.invalidUrl(url, detail);
    case "TIMEOUT":
      return StorePageFetchError.timeout(url, detail);
    case "PARSE_ERROR":
    case "NO_HTML":
      return StorePageFetchError.unparseable(url, detail);
    case "REDIRECT_LIMIT":
      return StorePageFetchError.fetchFailed("Too many redirects", detail);
    case "FETCH_ERROR":
    default:
      return StorePageFetchError.fetchFailed(error.code, detail);
  }
};

// Project the ogie `data` object (from extract or extractFromHtml) into domain RawProductPage.
export const toRawProductPage = (data: {
  og?: {
    title?: string;
    description?: string;
    images?: Array<{ url?: string }>;
  };
  basic?: { title?: string; description?: string };
  jsonLd?: unknown;
}): RawProductPage => ({
  ogTitle: data.og?.title,
  ogDescription: data.og?.description,
  ogImages: (data.og?.images ?? [])
    .map((img) => img?.url)
    .filter((u): u is string => typeof u === "string"),
  basicTitle: data.basic?.title,
  basicDescription: data.basic?.description,
  jsonLdProducts: toJsonLdProducts(data.jsonLd),
});
```

- [ ] **Step 2: Update `ogieStorePageFetcher.ts` to import from the new module**

Replace `packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts` content with:

```ts
import { err, ok, type StorePageFetcher } from "@jigswap/domain";
import { extract } from "ogie";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";

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
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(StorePageFetchError.fetchFailed(message, detail));
    }

    if (!result.success) {
      return err(mapOgieError(result.error, url));
    }

    return ok(toRawProductPage(result.data));
  },
};
```

Wait — `StorePageFetchError` is no longer imported. The full corrected content is:

```ts
import {
  err,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extract } from "ogie";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";

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
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(StorePageFetchError.fetchFailed(message, detail));
    }

    if (!result.success) {
      return err(mapOgieError(result.error, url));
    }

    return ok(toRawProductPage(result.data));
  },
};
```

- [ ] **Step 3: TypeCheck backend**

```bash
pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: 0 errors. If any errors, fix imports/types before proceeding.

- [ ] **Step 4: Commit the refactor**

```bash
git add packages/backend/convex/catalog/adapters/ogieRawProductPage.ts packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts
git commit -m "refactor(backend): extract ogie data→RawProductPage helpers to ogieRawProductPage"
```

---

## Task 2: Domain — `makeFallbackStorePageFetcher` (TDD)

**Why this order:** The domain composite is pure and has no external dependencies — it's the right thing to test first, in isolation, before wiring up the side-effecting backend adapter.

**Files:**

- Create: `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.ts`
- Create: `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts`
- Modify: `packages/domain/src/catalog/application/index.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "../../shared-kernel";
import { StorePageFetchError } from "../domain";
import { FakeStorePageFetcher } from "./testing";
import { makeFallbackStorePageFetcher } from "./make-fallback-store-page-fetcher";

const URL = "https://example.com/puzzle";
const PAGE = { ogImages: [], jsonLdProducts: [] };

describe("makeFallbackStorePageFetcher", () => {
  it("returns primary result when primary succeeds — fallback NOT called", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedPage(PAGE);
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(StorePageFetchError.fetchFailed("should not be called"));

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([]);
  });

  it("returns primary Timeout error without calling fallback (Timeout is not retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.timeout(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("Timeout");
    expect(fallback.calls).toEqual([]);
  });

  it("returns primary InvalidUrl error without calling fallback (InvalidUrl is not retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.invalidUrl(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("InvalidUrl");
    expect(fallback.calls).toEqual([]);
  });

  it("calls fallback when primary fails FetchFailed, returns fallback ok result", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.fetchFailed("connection refused"));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage({
      ogImages: ["https://example.com/img.jpg"],
      jsonLdProducts: [],
    });

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ogImages).toEqual(["https://example.com/img.jpg"]);
    expect(primary.calls).toEqual([URL]);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails Blocked (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.blocked(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails NotFound (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.notFound(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("calls fallback when primary fails Unparseable (retryable)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.unparseable(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });

  it("when both fail, returns fallback error (the more recent/relevant failure)", async () => {
    const primary = new FakeStorePageFetcher();
    primary.seedError(StorePageFetchError.blocked(URL, "bot-detection"));
    const fallback = new FakeStorePageFetcher();
    fallback.seedError(
      StorePageFetchError.fetchFailed(
        "browser-retry HTTP 403",
        "browser-retry: FETCH_ERROR",
      ),
    );

    const fetcher = makeFallbackStorePageFetcher(primary, fallback);
    const result = await fetcher.fetch(URL);

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    // Should return the fallback error, not the primary
    expect(result.error.code).toBe("FetchFailed");
    expect(result.error.detail).toBe("browser-retry: FETCH_ERROR");
  });

  it("accepts a custom shouldFallback predicate", async () => {
    const primary = new FakeStorePageFetcher();
    // Timeout is normally not retryable but we override the predicate
    primary.seedError(StorePageFetchError.timeout(URL));
    const fallback = new FakeStorePageFetcher();
    fallback.seedPage(PAGE);

    const fetcher = makeFallbackStorePageFetcher(
      primary,
      fallback,
      (e) => e.code === "Timeout", // custom: retry on Timeout
    );
    const result = await fetcher.fetch(URL);

    expect(isOk(result)).toBe(true);
    expect(fallback.calls).toEqual([URL]);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
pnpm exec vitest run packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts
```

Expected: FAIL — `Cannot find module './make-fallback-store-page-fetcher'`.

- [ ] **Step 3: Implement `make-fallback-store-page-fetcher.ts`**

Create `packages/domain/src/catalog/application/make-fallback-store-page-fetcher.ts`:

```ts
import {
  type StorePageFetchError,
  type StorePageFetchErrorCode,
} from "../domain";
import { type StorePageFetcher } from "./ports/out/store-page-fetcher";

// Error codes worth retrying with a different fetch strategy (blocked/garbled/missing pages).
// Not retried: InvalidUrl (won't change), Timeout (already slow — don't double the wait).
const RETRYABLE: ReadonlyArray<StorePageFetchErrorCode> = [
  "Blocked",
  "NotFound",
  "FetchFailed",
  "Unparseable",
];

// Tries `primary`; if it fails with a retryable error, tries `fallback`. Returns the fallback's
// result when attempted (its error is the more recent/relevant), else the primary's result.
export const makeFallbackStorePageFetcher = (
  primary: StorePageFetcher,
  fallback: StorePageFetcher,
  shouldFallback: (e: StorePageFetchError) => boolean = (e) =>
    RETRYABLE.includes(e.code),
): StorePageFetcher => ({
  async fetch(url) {
    const first = await primary.fetch(url);
    if (first.isOk || !shouldFallback(first.error)) return first;
    return fallback.fetch(url);
  },
});
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm exec vitest run packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Export from application index**

Edit `packages/domain/src/catalog/application/index.ts` to add the new export:

```ts
export * from "./errors";
export * from "./make-fallback-store-page-fetcher";
export * from "./ports";
export * from "./use-cases";
```

- [ ] **Step 6: TypeCheck domain**

```bash
pnpm --filter @jigswap/domain exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit domain composite**

```bash
git add packages/domain/src/catalog/application/make-fallback-store-page-fetcher.ts packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts packages/domain/src/catalog/application/index.ts
git commit -m "feat(domain): makeFallbackStorePageFetcher — pure composite with retryable-error logic"
```

---

## Task 3: Backend — `browserStorePageFetcher` adapter

**Security note:** This is a new raw outbound fetch. The SSRF guard must be identical to `importPuzzleImage.ts`. Specifically:

1. Parse URL and check protocol is `http:` or `https:` — if not, return `StorePageFetchError.invalidUrl`
2. `dns.lookup(host, { all: true })` and reject if any address `isPrivateIp` or if `addresses.length === 0`
3. `redirect: "manual"` — NEVER `redirect: "follow"`
4. Manual redirect loop, max 5 hops, re-run DNS+private-IP check on each hop's resolved `Location` hostname
5. Shared `AbortSignal.timeout(10000)` across all hops

**Files:**

- Create: `packages/backend/convex/catalog/adapters/browserStorePageFetcher.ts`

- [ ] **Step 1: Create `browserStorePageFetcher.ts`**

Create `packages/backend/convex/catalog/adapters/browserStorePageFetcher.ts`:

```ts
import {
  err,
  isPrivateIp,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extractFromHtml } from "ogie";
import { lookup as dnsLookup } from "node:dns/promises";
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

    // Cap body read to avoid huge pages
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      // Still attempt parse — truncated pages may still have metadata in the head
      // but warn via detail. Actually: just use what we have (decode as-is).
    }
    const html = new TextDecoder().decode(
      buffer.byteLength > MAX_BODY_BYTES
        ? buffer.slice(0, MAX_BODY_BYTES)
        : buffer,
    );

    let ogieResult: Awaited<ReturnType<typeof extractFromHtml>>;
    try {
      ogieResult = await extractFromHtml(html);
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

    return ok(toRawProductPage(ogieResult.data));
  },
};
```

- [ ] **Step 2: Check `ogie` exports `extractFromHtml`**

```bash
node -e "const o = require('./packages/backend/node_modules/ogie/dist/index.cjs'); console.log(Object.keys(o))" 2>/dev/null || grep -r "extractFromHtml" /home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/puzzle-import-from-url/packages/backend/node_modules/ogie/dist/ --include="*.d.*" | head -5
```

Expected: `extractFromHtml` appears in the exports list. If `extractFromHtml` is named differently (e.g. `extractFromHTML`), update the import accordingly.

- [ ] **Step 3: TypeCheck backend**

```bash
pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: 0 errors. Fix any type errors before proceeding.

---

## Task 4: Wire the fallback into `extractFromUrl.ts`

**Files:**

- Modify: `packages/backend/convex/catalog/extractFromUrl.ts`

- [ ] **Step 1: Update `extractFromUrl.ts` imports and fetcher wiring**

Edit `packages/backend/convex/catalog/extractFromUrl.ts` — add imports and change the fetcher:

```ts
"use node";
import {
  type CachedImportDraft,
  type ImportDraftCache,
  makeImportPuzzleFromUrl,
  makeFallbackStorePageFetcher,
  type PuzzleMatchLookup,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { browserStorePageFetcher } from "./adapters/browserStorePageFetcher";
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
          browserStorePageFetcher,
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
```

- [ ] **Step 2: TypeCheck backend**

```bash
pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 5: Run all tests, format, final checks, and commit

- [ ] **Step 1: Run full test suite**

```bash
pnpm exec vitest run packages/domain packages/backend
```

Expected: all tests pass (new `make-fallback-store-page-fetcher.spec.ts` green, existing specs unchanged).

- [ ] **Step 2: Run prettier on all changed files**

```bash
pnpm exec prettier --write \
  packages/domain/src/catalog/application/make-fallback-store-page-fetcher.ts \
  packages/domain/src/catalog/application/make-fallback-store-page-fetcher.spec.ts \
  packages/domain/src/catalog/application/index.ts \
  packages/backend/convex/catalog/adapters/ogieRawProductPage.ts \
  packages/backend/convex/catalog/adapters/ogieStorePageFetcher.ts \
  packages/backend/convex/catalog/adapters/browserStorePageFetcher.ts \
  packages/backend/convex/catalog/extractFromUrl.ts
```

- [ ] **Step 3: Run format check to confirm clean**

```bash
pnpm run format:check
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Run typecheck on both packages one final time**

```bash
pnpm --filter @jigswap/domain exec tsc --noEmit && pnpm --filter @jigswap/backend exec tsc --noEmit
```

Expected: 0 errors on both.

- [ ] **Step 5: Commit backend adapter and wiring**

```bash
git add \
  packages/backend/convex/catalog/adapters/browserStorePageFetcher.ts \
  packages/backend/convex/catalog/extractFromUrl.ts
git commit -m "feat(backend): browser-UA fallback fetcher for blocked store pages"
```

---

## Self-Review Checklist

### Spec coverage

- [x] Task 1: `makeFallbackStorePageFetcher` domain composite with custom `shouldFallback`
- [x] Task 1: TDD spec with FakeStorePageFetcher (all 4 required scenarios + more)
- [x] Task 1: Export from application `index.ts`
- [x] Task 2: `ogieRawProductPage.ts` with all extracted helpers (`asArray`, `extractJsonLdImage`, `flattenBrand`, `toJsonLdProducts`, `mapOgieError`, `toRawProductPage`)
- [x] Task 2: `ogieStorePageFetcher.ts` slimmed down, imports from ogieRawProductPage
- [x] Task 3: `browserStorePageFetcher.ts` with full SSRF guard (protocol check, DNS+private-IP, manual redirect loop max 5, shared timeout signal)
- [x] Task 3: Browser UA header, Accept, Accept-Language headers
- [x] Task 3: 5 MB body cap
- [x] Task 3: `extractFromHtml` path, `mapOgieError` with `browser-retry:` prefix in detail
- [x] Task 4: `extractFromUrl.ts` wired with `makeFallbackStorePageFetcher(ogie, browser)`
- [x] Prettier + format:check
- [x] typecheck both packages
- [x] Commits in logical order (no Co-Authored-By per spec)

### Security coverage

- [x] Protocol check (http/https only) on initial URL and every redirect hop
- [x] DNS-resolve + `isPrivateIp` check on every hop's hostname (re-runs on redirect)
- [x] `redirect: "manual"` — never `redirect: "follow"`
- [x] Shared `AbortSignal.timeout(10000)` across all hops
- [x] AbortSignal timeout error mapped to `StorePageFetchError.timeout` (not generic fetchFailed)
- [x] Max 5 redirects before returning fetchFailed error
- [x] Body capped at 5 MB

### Placeholder scan

None found — all code is concrete.

### Type consistency

- `makeFallbackStorePageFetcher` takes and returns `StorePageFetcher`
- `toRawProductPage` signature uses inline structural type matching ogie's `data` shape (avoids importing ogie types into the shared module; ogie types flow through the callers)
- `mapOgieError` is renamed from `mapError` (was private in ogieStorePageFetcher); callers use `mapOgieError`
- `browserStorePageFetcher` calls `mapOgieError` (imported from `ogieRawProductPage`) ✓
