// Web Mercator math for the location picker's server-rendered map (the same
// projection the backend renders with: 512 px tiles, the MapLibre zoom
// convention). The picker's map is a plain image of a known view (centre,
// zoom, size), so a tap converts to coordinates here, and the arrow buttons
// pan by a share of the view. The pin is always the view's centre.

const TILE_SIZE = 512;
const MAX_LAT = 85.05112878;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;

export interface MapViewport {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** lat/lng -> global pixel coordinates at `zoom`. */
export function project(lat: number, lng: number, zoom: number) {
  const size = worldSize(zoom);
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

/** Global pixel coordinates at `zoom` -> lat/lng, longitude wrapped to [-180, 180). */
export function unproject(x: number, y: number, zoom: number) {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lng = (x / size) * 360 - 180;
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: ((((lng + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * The coordinates under a point of the rendered image. `x`/`y` are in the
 * image's own pixels (scale a tap on a resized image by naturalWidth /
 * clientWidth first).
 */
export function pixelToLatLng(view: MapViewport, x: number, y: number) {
  const centre = project(view.lat, view.lng, view.zoom);
  return unproject(
    centre.x + (x - view.width / 2),
    centre.y + (y - view.height / 2),
    view.zoom,
  );
}

/** A tap on an image displayed at `shown` px, mapped into the view's pixels. */
export function tapToLatLng(
  view: MapViewport,
  tap: { x: number; y: number },
  shown: { width: number; height: number },
) {
  return pixelToLatLng(
    view,
    (tap.x * view.width) / shown.width,
    (tap.y * view.height) / shown.height,
  );
}

/**
 * The centre after panning by a share of the view (`dx`/`dy` in view widths
 * and heights; positive = east / south).
 */
export function panBy(view: MapViewport, dx: number, dy: number) {
  return pixelToLatLng(
    view,
    view.width / 2 + dx * view.width,
    view.height / 2 + dy * view.height,
  );
}

export const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));

/** Round to 5 decimals (~1 m): what an exact location is stored at anyway. */
export const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * A GPS fix used only as a search hint, coarsened before it leaves the
 * device (the server snaps it to its ~1 km grid as well).
 */
export const coarsen = (value: number) => Math.round(value * 100) / 100;
