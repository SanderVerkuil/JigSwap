import type { PlaceSearchResultView } from "@jigswap/contracts";
import { SharedLocation } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import {
  fetchMapTiler,
  GEOCODING_MAX_BYTES,
  geocodingUrl,
  MapTilerError,
  MAX_SEARCH_QUERY_LENGTH,
  readMapTilerConfig,
  searchLanguageOf,
  toPlaceResults,
} from "./adapters/mapTiler";

const MIN_QUERY_LENGTH = 2;
const SEARCH_TIMEOUT_MS = 6_000;
// "52.09, 5.12" / "52.09 5.12": a bare coordinate pair is not a place search (a reverse lookup
// would turn coordinates into an address); it gets no results.
const COORDINATES_ONLY =
  /^[-+]?\d+(?:[.,]\d+)?\s*[,;\s]\s*[-+]?\d+(?:[.,]\d+)?$/;

const unavailable = () =>
  new ConvexError({
    code: "SearchUnavailable",
    message: "Place search isn't available right now",
  });

/**
 * The query as it may go to the provider: trimmed, without `;` (MapTiler reads it as a batch
 * separator), capped at MAX_SEARCH_QUERY_LENGTH. Null for one that is too short or only
 * coordinates.
 */
export const normalizeSearchQuery = (raw: string): string | null => {
  const query = raw
    .replace(/;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH)
    .trim();
  if (query.length < MIN_QUERY_LENGTH) return null;
  if (COORDINATES_ONLY.test(query)) return null;
  return query;
};

// Place search for the location picker (spec R.6): a proxy for MapTiler Geocoding, so the
// sender's browser never contacts MapTiler. Gated like every picker call (gateLocationCall:
// participant, not blocked, the locationSearch limit, one request charged to the global MapTiler
// budget). Searches the default countries (nl, be, de) including POIs, ranked in the member's
// preferred language and, when given, near `near`, which is always snapped to the ~1 km grid
// first (it may come from the device's GPS). A query that is too short or only coordinates gets
// no results without any call. Returns at most 5 { label, lat, lng }, never the provider payload;
// a response over GEOCODING_MAX_BYTES is a failed search. The wide event carries neither the
// query nor coordinates.
export const searchPlaces = action({
  args: {
    threadId: v.string(),
    query: v.string(),
    near: v.optional(v.object({ lat: v.number(), lng: v.number() })),
  },
  handler: async (ctx, args): Promise<PlaceSearchResultView[]> => {
    const query = normalizeSearchQuery(args.query);
    if (query === null) return [];
    const { preferredLanguage } = await ctx.runMutation(
      internal.conversation.locationStore.gateLocationCall,
      {
        threadId: args.threadId,
        limit: "locationSearch",
        upstreamRequests: 1,
      },
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
    try {
      const bytes = await fetchMapTiler(
        fetch,
        geocodingUrl(config, {
          query,
          language: searchLanguageOf(preferredLanguage),
          near,
        }),
        { maxBytes: GEOCODING_MAX_BYTES, timeoutMs: SEARCH_TIMEOUT_MS },
      );
      const results = toPlaceResults(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      logEvent({
        event: "conversation.searchPlaces",
        outcome: "success",
        results: results.length,
        near: near !== undefined,
        duration_ms: Date.now() - startedAt,
      });
      return results;
    } catch (error) {
      logEvent({
        event: "conversation.searchPlaces",
        outcome: "error",
        failure:
          error instanceof MapTilerError ? error.reason : "invalid_response",
        ...(error instanceof MapTilerError &&
          error.status !== undefined && { status: error.status }),
        duration_ms: Date.now() - startedAt,
      });
      throw unavailable();
    }
  },
});
