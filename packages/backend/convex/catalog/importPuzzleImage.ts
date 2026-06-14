"use node";
import { isPrivateIp } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { lookup as dnsLookup } from "node:dns/promises";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
// Raster formats only. SVG is intentionally excluded — it can carry scripts (stored-XSS vector).
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

// Reject any hostname that resolves to a private/loopback/link-local address (SSRF guard).
const assertPublicHost = async (hostname: string): Promise<void> => {
  const addresses = await dnsLookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new ConvexError("Refused to fetch image (blocked address)");
  }
};

// Public Node action: fetch a remote image (no hotlinking) and store it in Convex storage.
// Carries its OWN SSRF guard — ogie protects only the page fetch, not this raw image fetch.
// Redirects are followed MANUALLY so every hop is re-validated against the private-IP guard
// (redirect:"follow" would let a public->private redirect bypass the pre-flight DNS check).
export const importPuzzleImage = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Id<"_storage">> => {
    // Gate outbound fetch + blob storage behind authentication (abuse/cost amplifier otherwise).
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new ConvexError("Unauthenticated");
    }

    const signal = AbortSignal.timeout(10000); // shared deadline across all hops
    let currentUrl = url;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        throw new ConvexError("Invalid image URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ConvexError("Unsupported image protocol");
      }
      await assertPublicHost(parsed.hostname);

      const res = await fetch(currentUrl, {
        headers: { "User-Agent": "JigSwapBot/1.0" },
        signal,
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location)
          throw new ConvexError("Redirect without a location header");
        currentUrl = new URL(location, currentUrl).toString(); // resolve relative redirects
        continue;
      }
      response = res;
      break;
    }

    if (!response) throw new ConvexError("Too many redirects");
    if (!response.ok)
      throw new ConvexError(`Image fetch failed: ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!ALLOWED_TYPES.some((t) => contentType.startsWith(t))) {
      throw new ConvexError("Unsupported image type");
    }
    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (declaredLength > MAX_BYTES) throw new ConvexError("Image too large");

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new ConvexError("Image too large");

    return await ctx.storage.store(new Blob([buffer], { type: contentType }));
  },
});
