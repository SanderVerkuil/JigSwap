"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { fetchPublic, readBodyCapped } from "./adapters/publicFetch";
import { checkBoxArt } from "./moderateBoxArt";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;

// Public Node action: fetch a remote image (no hotlinking) and store it in Convex storage as box
// art, through exactly the checks an uploaded one gets (catalog/moderateBoxArt): only an image by
// its magic bytes (never SVG, which can carry scripts), metadata stripped, CSAM hash check,
// content check, listed for the member (boxArtUploads).
// SSRF: the fetch goes through catalog/adapters/publicFetch, which checks the address inside the
// connection's own DNS lookup on every redirect hop, so neither a private host nor a DNS rebind
// can be reached. The body is read only up to MAX_BYTES, and a failed fetch tells the caller
// nothing about the remote side (the status goes to the server log only).
export const importPuzzleImage = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Id<"_storage">> => {
    // Gate outbound fetch + blob storage behind authentication (abuse/cost amplifier otherwise).
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new ConvexError("Unauthenticated");
    }
    // Only an active member, within their box-art bucket (admins exempt), before any fetch.
    await ctx.runMutation(internal.catalog.boxArtUploads.chargeBoxArtCheck, {});

    const outcome = await fetchPublic(url, {
      headers: { "User-Agent": "JigSwapBot/1.0" },
      signal: AbortSignal.timeout(10000), // one deadline across all hops and the body
      maxRedirects: MAX_REDIRECTS,
    });
    if (!outcome.ok) {
      throw new ConvexError(
        outcome.code === "Blocked"
          ? "Refused to fetch image (blocked address)"
          : "Invalid image URL",
      );
    }
    const { response } = outcome;

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ConvexError(
        response.headers.get("location") === null
          ? "Redirect without a location header"
          : "Too many redirects",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      console.warn(
        `importPuzzleImage: image fetch failed with HTTP ${response.status}`,
      );
      throw new ConvexError("Image fetch failed");
    }

    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (declaredLength > MAX_BYTES) {
      await response.body?.cancel();
      throw new ConvexError("Image too large");
    }
    const { bytes, truncated } = await readBodyCapped(response, MAX_BYTES);
    if (truncated) throw new ConvexError("Image too large");

    // Checked like an uploaded file (catalog/moderateBoxArt.checkBoxArt): the content-type
    // header is not trusted (CDNs serve real JPEGs as octet-stream); the pipeline's guards decide
    // by the magic bytes, and a refused body (an SVG, HTML) is deleted, never served.
    const uploadId = await ctx.storage.store(
      new Blob([bytes], { type: "application/octet-stream" }),
    );
    return checkBoxArt(ctx, uploadId);
  },
});
