"use node";
import { isPrivateIp } from "@jigswap/domain";
import { lookup as dnsLookup } from "node:dns/promises";

// Centralised SSRF pre-flight for the import pipeline's INITIAL url. Enforces an http(s) scheme and
// a DNS-resolved public host ONCE, so every fetcher tier only ever sees a pre-validated public host.
// Reuses the domain `isPrivateIp` rule rather than re-implementing it.
//
// Redirect-hop coverage (this guards the ENTRY url only; tiers that follow redirects re-validate
// each hop themselves):
//   - browserStorePageFetcher: re-runs a DNS-resolving guard on EVERY hop (redirect:"manual").
//   - ogieStorePageFetcher: ogie fetches with redirect:"manual" and re-validates every hop against
//     literal private IPs/internal TLDs (allowPrivateUrls:false is pinned), so a redirect to a
//     literal private IP is rejected. Its per-hop check is LEXICAL only — a public hostname that
//     DNS-resolves to a private IP on a redirect hop falls through to the DNS-validating browser
//     tier rather than being followed by ogie. This narrow DNS-rebinding-on-redirect residual is
//     the only remaining gap and is acceptable given the validating fallback.
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
