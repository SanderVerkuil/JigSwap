"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { renderMap } from "./adapters/mapRender";
import {
  MapTilerError,
  readMapTilerConfig,
  upstreamRequestsFor,
} from "./adapters/mapTiler";
import {
  APPROXIMATE_MAP_ZOOM,
  APPROXIMATE_RADIUS_METRES,
  EXACT_MAP_ZOOM,
  LOCATION_MAP_HEIGHT,
  LOCATION_MAP_WIDTH,
} from "./sharedLocations";

// The final map preview of a shared location, rendered ONCE at send time (spec 2.4, R.6) and
// stored in Convex storage, so recipients load it from us and no map provider ever sees them.
// Scheduled by sendLocation. Exact: a pin at street level; approximate: a shaded ~1 km area.
// The tiles are charged to the global MapTiler budget first. Whatever happens (no key any more,
// the budget spent, a provider error), the render settles: "ready" with the
// map, or "failed" (a text card with the coordinates), and the message is appended either way.
// The wide event carries no coordinates, label or URL.
export const renderLocationMap = internalAction({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }): Promise<void> => {
    const location = await ctx.runQuery(
      internal.conversation.locationStore.getLocationForRender,
      { attachmentId },
    );
    if (!location) return;
    const startedAt = Date.now();
    let mapFileId;
    let failure: string | undefined;
    const config = readMapTilerConfig(process.env);
    const exact = location.precision === "exact";
    const view = {
      lat: location.lat,
      lng: location.lng,
      zoom: exact ? EXACT_MAP_ZOOM : APPROXIMATE_MAP_ZOOM,
      width: LOCATION_MAP_WIDTH,
      height: LOCATION_MAP_HEIGHT,
    };
    const charged =
      config.status === "ok" &&
      (await ctx.runMutation(internal.conversation.locationStore.chargeRender, {
        upstreamRequests: upstreamRequestsFor(config, view),
      }));
    if (config.status === "ok" && !charged) {
      // The global MapTiler budget is spent: a text card instead of a map.
      failure = "budget_exhausted";
    } else if (config.status === "ok") {
      try {
        const png = await renderMap(
          config,
          view,
          exact
            ? { lat: location.lat, lng: location.lng, style: "pin" }
            : {
                lat: location.lat,
                lng: location.lng,
                style: "area",
                radiusMetres: APPROXIMATE_RADIUS_METRES,
              },
        );
        mapFileId = await ctx.storage.store(
          new Blob([png.slice().buffer], { type: "image/png" }),
        );
      } catch (error) {
        failure =
          error instanceof MapTilerError
            ? `${error.reason}${error.status !== undefined ? `_${error.status}` : ""}`
            : "render_error";
      }
    } else {
      failure = "unavailable";
    }
    try {
      await ctx.runMutation(
        internal.conversation.locationStore.settleLocationMap,
        { attachmentId, ...(mapFileId && { mapFileId }) },
      );
    } catch (error) {
      if (mapFileId) await ctx.storage.delete(mapFileId).catch(() => {});
      throw error;
    }
    logEvent({
      event: "conversation.renderLocationMap",
      outcome: failure ? "error" : "success",
      attachment_id: attachmentId,
      precision: location.precision,
      map_status: failure ? "failed" : "ready",
      ...(failure && { failure }),
      duration_ms: Date.now() - startedAt,
    });
  },
});
