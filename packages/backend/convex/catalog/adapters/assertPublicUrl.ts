"use node";

import { lookup as dnsLookup } from "node:dns/promises";
import { isPrivateIp } from "@jigswap/domain";

// SSRF pre-flight for the import pipeline's INITIAL url: an http(s) scheme and a DNS-resolved
// public host (the domain `isPrivateIp` rule), checked once before the import cache and every
// fetcher tier. It is an early refusal, not the guard that makes our own fetches safe:
//
// The connection is what is checked. A separate resolve-then-fetch check cannot stop a DNS rebind
// (fetch() resolves the name again, and a low-TTL record can answer public here and private there).
// So the tiers that fetch from our own network go through catalog/adapters/publicFetch, which
// checks every address inside the socket's own DNS lookup, on every redirect hop:
//   - browserStorePageFetcher: the only page tier that follows redirects (at most five).
//   - catalog/importPuzzleImage: the box-art image fetch.
//   - ogieStorePageFetcher: the primary tier still uses ogie's own fetch, with
//     allowPrivateUrls:false (a lexical check only) and no redirect-following; a redirecting
//     store URL surfaces as a retryable FetchFailed and falls through to the browser tier.
//   - firecrawlStorePageFetcher: our egress only reaches api.firecrawl.dev (a public host); the
//     target page is fetched by Firecrawl's infra, not ours, so it is not an SSRF vector here.
export type PublicUrlCheck =
  { ok: true } | { ok: false; code: "InvalidUrl" | "Blocked"; reason: string };

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
