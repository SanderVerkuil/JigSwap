import { afterEach, describe, expect, test, vi } from "vitest";
import { ogieStorePageFetcher } from "./catalog/adapters/ogieStorePageFetcher";
import * as transport from "./catalog/adapters/publicFetch";

// The primary page tier fetches the entry URL through the SSRF-safe transport
// (catalog/adapters/publicFetch, covered by publicFetch.test.ts) and parses it with ogie. Here the
// transport answers through a stubbed global fetch; one test runs the real transport.

vi.mock("./catalog/adapters/publicFetch", async (importOriginal) =>
  (
    await import("../test-fixtures/publicFetchViaGlobalFetch")
  ).publicFetchViaGlobalFetch(importOriginal),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(transport.fetchPublic).mockClear();
});

const URL = "https://store.example.com/product/123";
const MB = 1024 * 1024;
const PAGE =
  '<html><head><title>Mountain Vista 1000</title><meta property="og:title" content="Mountain Vista"><meta property="og:image" content="/img/box.jpg"></head><body></body></html>';

const serve = (response: () => Response) => {
  const network = vi.fn(async (_input: RequestInfo | URL) => response());
  vi.stubGlobal("fetch", network);
  return network;
};

const html = (body: BodyInit | null, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });

describe("ogieStorePageFetcher SSRF guard", () => {
  // The real transport refuses an IP-literal entry URL before dispatch: no egress at all.
  const blockedTargets = [
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://127.0.0.1/", // loopback
    "http://[::1]/", // IPv6 loopback
    "http://10.0.0.1/", // RFC1918 private
    "http://192.168.1.1/", // RFC1918 private
  ];

  for (const url of blockedTargets) {
    test(`refuses a private/internal target without fetching: ${url}`, async () => {
      const real = await vi.importActual<typeof transport>(
        "./catalog/adapters/publicFetch",
      );
      vi.mocked(transport.fetchPublic).mockImplementationOnce(real.fetchPublic);

      const result = await ogieStorePageFetcher.fetch(url);

      expect(result.isErr && result.error.code).toBe("Blocked");
      expect(result.isErr && result.error.detail).toContain("blocked address");
    });
  }

  test("a host the transport refuses at connect time is Blocked", async () => {
    const network = serve(() => html(PAGE));
    vi.mocked(transport.fetchPublic).mockResolvedValueOnce({
      ok: false,
      code: "Blocked",
      detail: "Refused to fetch (blocked address): store.example.com",
    });

    const result = await ogieStorePageFetcher.fetch(URL);

    expect(result.isErr && result.error.code).toBe("Blocked");
    expect(network).not.toHaveBeenCalled();
  });
});

// SSRF: the ogie primary tier must NOT follow redirects. A redirecting store URL has to surface as
// a (retryable) failure so the import falls through to browserStorePageFetcher, the only page tier
// that follows redirects.
describe("ogieStorePageFetcher does not follow redirects", () => {
  test("a 3xx response surfaces as a retryable failure, not a followed hop", async () => {
    const network = serve(
      () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://store.example.com/moved" },
        }),
    );

    const result = await ogieStorePageFetcher.fetch(URL);

    expect(vi.mocked(transport.fetchPublic)).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ maxRedirects: 0 }),
    );
    expect(network.mock.calls.map(([input]) => String(input))).toEqual([URL]);
    // As ogie's REDIRECT_LIMIT did: a retryable FetchFailed, which triggers the fallback chain.
    expect(result.isErr && result.error.code).toBe("FetchFailed");
    expect(result.isErr && result.error.message).toContain(
      "Too many redirects",
    );
  });
});

describe("ogieStorePageFetcher parses the page as ogie's own fetch did", () => {
  test("reads the metadata, resolving relative URLs against the page", async () => {
    serve(() => html(PAGE));

    const result = await ogieStorePageFetcher.fetch(URL);

    expect(vi.mocked(transport.fetchPublic)).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "JigSwapBot/1.0" }),
      }),
    );
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toMatchObject({
        ogTitle: "Mountain Vista",
        basicTitle: "Mountain Vista 1000",
        ogImages: ["https://store.example.com/img/box.jpg"],
        source: "ogie",
      });
    }
  });

  test("a non-2xx or non-HTML answer is a retryable FetchFailed", async () => {
    serve(() => html("gone", { status: 404 }));
    const missing = await ogieStorePageFetcher.fetch(URL);
    expect(missing.isErr && missing.error.code).toBe("FetchFailed");

    serve(
      () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    const json = await ogieStorePageFetcher.fetch(URL);
    expect(json.isErr && json.error.code).toBe("FetchFailed");
  });

  test("a timeout is reported as Timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );

    const result = await ogieStorePageFetcher.fetch(URL);

    expect(result.isErr && result.error.code).toBe("Timeout");
  });

  test("a page over 10 MB fails without reading the rest", async () => {
    const CHUNK = 64 * 1024;
    let produced = 0;
    serve(() =>
      html(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (produced >= 25 * MB) {
              controller.close();
              return;
            }
            produced += CHUNK;
            controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
          },
        }),
      ),
    );

    const result = await ogieStorePageFetcher.fetch(URL);

    expect(result.isErr && result.error.code).toBe("FetchFailed");
    expect(produced).toBeLessThanOrEqual(10 * MB + 2 * CHUNK);
  });
});
