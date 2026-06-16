import { afterEach, describe, expect, test, vi } from "vitest";
import { ogieStorePageFetcher } from "./catalog/adapters/ogieStorePageFetcher";

// SSRF regression: the ogie primary tier pins allowPrivateUrls:false, so ogie's own per-hop
// validation rejects a LITERAL private/loopback/link-local URL up front — including a redirect
// target — WITHOUT performing any network egress (the lexical check throws before fetch). These
// cover the entry-URL leg directly; the same validateUrl runs on every redirect hop inside ogie
// (getRedirectUrl -> validateUrl), which is the redirect-hop SSRF this fix closes for this tier.
//
// We cannot exercise an actual redirect without a network/mocked HTTP server, so we assert the
// load-bearing behaviour: a private-IP target is rejected (mapped to a StorePageFetchError), never
// fetched. The DNS-validating browserStorePageFetcher remains the fallback for the DNS-rebinding
// case (a public hostname that resolves to a private IP), which ogie's lexical check does not cover.
describe("ogieStorePageFetcher SSRF guard", () => {
  const blockedTargets = [
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://127.0.0.1/", // loopback
    "http://[::1]/", // IPv6 loopback
    "http://10.0.0.1/", // RFC1918 private
    "http://192.168.1.1/", // RFC1918 private
  ];

  for (const url of blockedTargets) {
    test(`rejects a private/internal target without fetching: ${url}`, async () => {
      const result = await ogieStorePageFetcher.fetch(url);
      expect(result.isOk).toBe(false);
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        // It must be the SSRF rejection (mapped from ogie's INVALID_URL "private/internal network
        // address"), NOT a network timeout/failure — proving the address was never dialled. This
        // assertion fails if allowPrivateUrls is ever flipped to true.
        expect(result.error.code).toBe("InvalidUrl");
        expect(result.error.detail ?? "").toContain("private/internal network");
      }
    });
  }
});

// SSRF: the ogie primary tier must NOT follow redirects (maxRedirects:1). A redirecting store URL
// has to surface as a (retryable) failure so the import falls through to the DNS-validating
// browserStorePageFetcher, which is the only tier allowed to follow — and re-validate — redirect
// hops. We stub global fetch with a 301 from a PUBLIC-looking host (so ogie's lexical entry-URL
// check passes and it actually performs the fetch) and assert ogie reports a failure rather than
// chasing the Location header.
describe("ogieStorePageFetcher does not follow redirects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a 3xx response surfaces as a retryable failure, not a followed hop", async () => {
    const redirected = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const target = typeof input === "string" ? input : input.toString();
        // The entry URL is answered with a redirect; anything else means ogie followed the hop.
        if (target === "https://store.example.com/product/123") {
          return new Response(null, {
            status: 301,
            headers: { location: "https://store.example.com/moved" },
          });
        }
        redirected();
        return new Response("<html><head><title>Moved</title></head></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    );

    const result = await ogieStorePageFetcher.fetch(
      "https://store.example.com/product/123",
    );

    // ogie must not have dialled the redirect target.
    expect(redirected).not.toHaveBeenCalled();
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      // REDIRECT_LIMIT maps to a retryable FetchFailed, which triggers the fallback chain.
      expect(result.error.code).toBe("FetchFailed");
    }
  });
});
