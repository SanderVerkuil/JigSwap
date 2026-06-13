"use node";
import { isPrivateIp } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { lookup as dnsLookup } from "node:dns/promises";
import { action } from "../_generated/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Public Node action: fetch a remote image (no hotlinking) and store it in Convex storage.
// Carries its OWN SSRF guard — ogie protects only the page fetch, not this raw image fetch.
export const importPuzzleImage = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<string> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ConvexError("Invalid image URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConvexError("Unsupported image protocol");
    }

    const addresses = await dnsLookup(parsed.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
      throw new ConvexError("Refused to fetch image (blocked address)");
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "JigSwapBot/1.0" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) throw new ConvexError(`Image fetch failed: ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new ConvexError("URL did not return an image");
    }
    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BYTES) throw new ConvexError("Image too large");

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new ConvexError("Image too large");

    const storageId = await ctx.storage.store(new Blob([buffer], { type: contentType }));
    return storageId;
  },
});
