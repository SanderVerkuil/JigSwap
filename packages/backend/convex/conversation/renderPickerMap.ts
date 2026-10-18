"use node";

import type { PickerMapView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { renderMap } from "./adapters/mapRender";
import {
  clampZoom,
  MapTilerError,
  readMapTilerConfig,
  upstreamRequestsFor,
} from "./adapters/mapTiler";
import {
  PICKER_MAP_HEIGHT,
  PICKER_MAP_TTL_MS,
  PICKER_MAP_WIDTH,
} from "./sharedLocations";

// Mercator's latitude limit, and how far the picker's centre may go.
const MAX_LAT = 85;

const unavailable = () =>
  new ConvexError({
    code: "MapUnavailable",
    message: "The map can't be shown right now",
  });

// One view of the location picker (spec R.6, picker without a client key): MapTiler raster tiles
// composed server-side into a PICKER_MAP_WIDTH x PICKER_MAP_HEIGHT PNG with the pin at its centre
// and the attribution, so the sender's browser never contacts MapTiler. Every pan, zoom and tap
// re-renders through here. Gated like every picker call (gateLocationCall: participant, not
// blocked, the locationPicker limit, the global MapTiler budget). The image is a temporary
// blob, deleted PICKER_MAP_TTL_MS later; its URL goes only to the caller. The wide event carries
// no coordinates.
export const renderPickerMap = action({
  args: {
    threadId: v.string(),
    lat: v.number(),
    lng: v.number(),
    zoom: v.number(),
    // "gps": this view is centred on the device position ("Use my current location"); it is
    // remembered briefly for sendLocation's precision guardrail (locationGpsViews).
    mode: v.optional(v.literal("gps")),
  },
  handler: async (ctx, args): Promise<PickerMapView> => {
    if (
      !Number.isFinite(args.lat) ||
      !Number.isFinite(args.lng) ||
      !Number.isFinite(args.zoom) ||
      Math.abs(args.lat) > 90 ||
      Math.abs(args.lng) > 180
    ) {
      throw new ConvexError({
        code: "InvalidCoordinates",
        message: "Those coordinates are not valid",
      });
    }
    const config = readMapTilerConfig(process.env);
    const view = {
      lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, args.lat)),
      lng: args.lng,
      zoom: clampZoom(args.zoom),
      width: PICKER_MAP_WIDTH,
      height: PICKER_MAP_HEIGHT,
    };
    await ctx.runMutation(
      internal.conversation.locationStore.gateLocationCall,
      {
        threadId: args.threadId,
        limit: "locationPicker",
        upstreamRequests:
          config.status === "ok" ? upstreamRequestsFor(config, view) : 0,
        ...(args.mode === "gps" && {
          gpsView: { lat: view.lat, lng: view.lng },
        }),
      },
    );
    if (config.status !== "ok") throw unavailable();
    let png: Uint8Array;
    try {
      png = await renderMap(config, view, {
        lat: view.lat,
        lng: view.lng,
        style: "pin",
      });
    } catch (error) {
      logEvent({
        event: "conversation.renderPickerMap",
        outcome: "error",
        failure:
          error instanceof MapTilerError
            ? `${error.reason}${error.status !== undefined ? `_${error.status}` : ""}`
            : "render_error",
      });
      throw unavailable();
    }
    const fileId = await ctx.storage.store(
      new Blob([png.slice().buffer], { type: "image/png" }),
    );
    await ctx.scheduler.runAfter(
      PICKER_MAP_TTL_MS,
      internal.conversation.locationStore.deletePickerMap,
      { fileId },
    );
    const url = await ctx.storage.getUrl(fileId);
    if (url === null) throw unavailable();
    return { url, ...view };
  },
});
