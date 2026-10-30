import { afterEach, describe, expect, test, vi } from "vitest";
import { browserStorePageFetcher } from "./catalog/adapters/browserStorePageFetcher";
import { fetchPublic } from "./catalog/adapters/publicFetch";

// The browser-UA tier fetches through the SSRF-safe transport (catalog/adapters/publicFetch,
// covered by publicFetch.test.ts; faked here through a stubbed global fetch). These cover how the
// tier maps the transport's answers, and that a huge page is read only up to its 5 MB cap.

vi.mock("./catalog/adapters/publicFetch", async (importOriginal) =>
  (
    await import("../test-fixtures/publicFetchViaGlobalFetch")
  ).publicFetchViaGlobalFetch(importOriginal),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const URL = "https://store.example/puzzle/123";
const MB = 1024 * 1024;
const HEAD =
  '<html><head><title>Mountain Vista 1000</title><meta property="og:title" content="Mountain Vista"></head><body>';

const serve = (response: () => Response) => {
  const network = vi.fn(async () => response());
  vi.stubGlobal("fetch", network);
  return network;
};

describe("browserStorePageFetcher", () => {
  test("a host the transport refuses is Blocked, a bad URL InvalidUrl", async () => {
    const network = serve(() => new Response(HEAD));
    vi.mocked(fetchPublic)
      .mockResolvedValueOnce({
        ok: false,
        code: "Blocked",
        detail: "Refused to fetch (blocked address): store.example",
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "InvalidUrl",
        detail: "Not an http(s) URL: file:///etc/passwd",
      });

    const blocked = await browserStorePageFetcher.fetch(URL);
    const invalid = await browserStorePageFetcher.fetch(URL);

    expect(blocked.isErr && blocked.error.code).toBe("Blocked");
    expect(invalid.isErr && invalid.error.code).toBe("InvalidUrl");
    expect(network).not.toHaveBeenCalled();
  });

  test("asks the transport to follow at most five redirects", async () => {
    serve(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://store.example/again" },
        }),
    );

    const result = await browserStorePageFetcher.fetch(URL);

    expect(vi.mocked(fetchPublic)).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ maxRedirects: 5 }),
    );
    // A redirect handed back by the transport means the limit was reached.
    expect(result.isErr && result.error.code).toBe("FetchFailed");
    expect(result.isErr && result.error.message).toContain(
      "Too many redirects",
    );
  });

  test("a non-2xx page is FetchFailed and a non-HTML one Unparseable", async () => {
    serve(() => new Response("gone", { status: 404 }));
    const missing = await browserStorePageFetcher.fetch(URL);
    expect(missing.isErr && missing.error.code).toBe("FetchFailed");

    serve(
      () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    const json = await browserStorePageFetcher.fetch(URL);
    expect(json.isErr && json.error.code).toBe("Unparseable");
  });

  test("a huge page is read only up to 5 MB and its head still parsed", async () => {
    // HEAD, then 25 MB of body, produced only as fast as it is read.
    const CHUNK = 64 * 1024;
    let produced = 0;
    serve(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(HEAD));
            },
            pull(controller) {
              if (produced >= 25 * MB) {
                controller.close();
                return;
              }
              produced += CHUNK;
              controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
            },
          }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );

    const result = await browserStorePageFetcher.fetch(URL);

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.ogTitle).toBe("Mountain Vista");
      expect(result.value.source).toBe("browser-ua");
    }
    expect(produced).toBeLessThanOrEqual(5 * MB + 2 * CHUNK);
  });
});
