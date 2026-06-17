"use node";
import { isPrivateIp } from "@jigswap/domain";
import { lookup as dnsLookup } from "node:dns/promises";

// Centralised SSRF pre-flight for the import pipeline's INITIAL url. Enforces an http(s) scheme and
// a DNS-resolved public host ONCE, so every fetcher tier only ever sees a pre-validated public host.
// Reuses the domain `isPrivateIp` rule rather than re-implementing it.
//
// RESIDUAL RISK — DNS-rebinding TOCTOU on the initial request (finding #14, accepted):
//   This guard resolves the hostname and validates the addresses, but the subsequent fetch() does
//   its OWN independent DNS resolution. An attacker controlling authoritative DNS for an attacker-
//   owned hostname can return a public IP here and a private/loopback IP (e.g. 169.254.169.254
//   metadata) for the fetch's resolution, with a low TTL between the two. The redirect-hop case is
//   re-validated per hop (see below), but this single-request rebind is NOT closed by re-validation.
//   Fully closing it requires pinning the validated IP into the connection (a custom undici
//   Dispatcher whose `lookup` returns ONLY the already-validated address, preserving Host/SNI) — a
//   non-trivial change in the "use node" runtime, deferred rather than shipped as a risky partial.
//   Defense-in-depth that IS in place: isPrivateIp blocks loopback/RFC-1918/link-local/CGNAT
//   (100.64/10)/192.0.0.0/24 including the 169.254.169.254 metadata IP, so a rebind can only reach
//   genuinely public IPs that happen to front internal services.
//
// Redirect-hop coverage (this guards the ENTRY url only; redirect-following is concentrated in the
// single tier that DNS-validates every hop):
//   - browserStorePageFetcher: the ONLY tier that follows redirects. It re-runs a DNS-resolving
//     guard on EVERY hop (redirect:"manual"), so a public hostname that DNS-resolves to a private
//     IP on a redirect hop is caught here. The DNS-rebinding-on-redirect case is fully covered.
//   - ogieStorePageFetcher: the primary tier does NOT follow redirects (maxRedirects:1 = fetch
//     entry, follow zero hops). A redirecting store URL surfaces as a retryable FetchFailed and
//     falls through to browserStorePageFetcher above. allowPrivateUrls:false is pinned so a literal
//     private/loopback/link-local entry URL is rejected by ogie before any egress.
//   - firecrawlStorePageFetcher: our egress only reaches api.firecrawl.dev (a public host); the
//     target page is fetched by Firecrawl's infra, not ours, so it is not an SSRF vector here.
export type PublicUrlCheck =
  | { ok: true }
  | { ok: false; code: "InvalidUrl" | "Blocked"; reason: string };

export const assertPublicUrl = async (url: string): Promise<PublicUrlCheck> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "InvalidUrl", reason: "URL parse error" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "InvalidUrl",
      reason: `Unsupported protocol: ${parsed.protocol}`,
    };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsLookup(parsed.hostname, { all: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "Blocked", reason: `DNS lookup failed: ${msg}` };
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    return {
      ok: false,
      code: "Blocked",
      reason: `Refused to fetch (blocked address): ${parsed.hostname}`,
    };
  }
  return { ok: true };
};
