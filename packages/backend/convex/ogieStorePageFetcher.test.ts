import { describe, expect, test } from "vitest";
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
