import type { PlaceSearchResultView } from "@jigswap/contracts";
import { SharedLocation } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import {
  geocodingUrl,
  MAX_SEARCH_QUERY_LENGTH,
  readMapTilerConfig,
  searchLanguageOf,
  toPlaceResults,
} from "./adapters/mapTiler";

const MIN_QUERY_LENGTH = 2;
const SEARCH_TIMEOUT_MS = 6_000;

const unavailable = () =>
  new ConvexError({
    code: "SearchUnavailable",
    message: "Place search isn't available right now",
  });

// Place search for the location picker (spec R.6): a proxy for MapTiler Geocoding, so the
// sender's browser never contacts MapTiler. Gated like every picker call (gateLocationCall:
// participant, not blocked, the locationSearch limit). Searches the default countries (nl, be,
// de) including POIs, ranked in the member's preferred language and, when given, near `near`,
// which is always snapped to the ~1 km grid first (it may come from the device's GPS). Returns at
// most 5 { label, lat, lng }, never the provider payload. The wide event carries neither the
// query nor coordinates.
export const searchPlaces = action({
  args: {
    threadId: v.string(),
    query: v.string(),
    near: v.optional(v.object({ lat: v.number(), lng: v.number() })),
  },
  handler: async (ctx, args): Promise<PlaceSearchResultView[]> => {
    const query = args.query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    if (query.length < MIN_QUERY_LENGTH) return [];
    const { preferredLanguage } = await ctx.runMutation(
      internal.conversation.locationStore.gateLocationCall,
      { threadId: args.threadId, limit: "locationSearch" },
    );
    const config = readMapTilerConfig(process.env);
    if (config.status !== "ok") throw unavailable();

    const snapped = args.near
      ? SharedLocation.create({ ...args.near, precision: "approximate" })
      : null;
    const near =
      snapped?.isOk === true
        ? { lat: snapped.value.lat, lng: snapped.value.lng }
        : undefined;
    const startedAt = Date.now();
    let status: number | undefined;
    try {
      const response = await fetch(
        geocodingUrl(config, {
          query,
          language: searchLanguageOf(preferredLanguage),
          near,
        }),
        { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
      );
      status = response.status;
      if (!response.ok) throw unavailable();
      const results = toPlaceResults(await response.json());
      logEvent({
        event: "conversation.searchPlaces",
        outcome: "success",
        results: results.length,
        near: near !== undefined,
        duration_ms: Date.now() - startedAt,
      });
      return results;
    } catch {
      logEvent({
        event: "conversation.searchPlaces",
        outcome: "error",
        ...(status !== undefined && { status }),
        duration_ms: Date.now() - startedAt,
      });
      throw unavailable();
    }
  },
});
