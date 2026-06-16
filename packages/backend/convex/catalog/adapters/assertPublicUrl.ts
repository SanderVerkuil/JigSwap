"use node";
import { isPrivateIp } from "@jigswap/domain";
import { lookup as dnsLookup } from "node:dns/promises";

// Centralised SSRF pre-flight for the import pipeline's INITIAL url. Enforces an http(s) scheme and
// a DNS-resolved public host ONCE, so every fetcher tier (ogie — lexical-only; firecrawl — forwards
// the raw url; browser — does its own per-hop guard) only ever sees a pre-validated public host.
// Reuses the domain `isPrivateIp` rule rather than re-implementing it.
//
// NOTE: this guards the entry url only. Tiers that follow redirects MUST still re-validate each hop
// (browserStorePageFetcher already does); a public->private redirect inside ogie/firecrawl is a
// separate, deeper concern tracked as a follow-up.
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
