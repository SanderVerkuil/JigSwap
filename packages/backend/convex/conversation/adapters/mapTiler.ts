// MapTiler, the map provider behind location sharing (spec R.6). Pure, dependency-free helpers
// (no Convex ctx, no "use node") so the URL building, the response mapping and the Web Mercator
// math are unit-testable with a fake `fetch`.
//
// PRIVACY: only Convex actions ever call MapTiler, so neither the sender's nor the recipient's IP
// reaches it. The key is server-only: it is read here for the actions that build request URLs,
// and is never returned, logged or put in an error. Errors carry status codes only, never a URL.
//
// ENV (per Convex deployment, never Vercel / VITE_*):
//   MAPTILER_API_KEY     - the MapTiler Cloud key. Unset => location sharing is inert: the composer
//                          hides Location and every location function refuses LocationUnavailable.
//   MAPTILER_MAP_ID      - optional raster map id, default "streets-v4" ([A-Za-z0-9_-] only).
//   MAPTILER_STATIC_API  - optional "true": render through one Static Maps request instead of
//                          composing raster tiles (Static Maps is not on the free plan).

export const MAPTILER_ORIGIN = "https://api.maptiler.com";
export const DEFAULT_MAP_ID = "streets-v4";

/** The text drawn on every rendered map (MapTiler terms: map content and OSM data credits). */
export const MAP_ATTRIBUTION = "© MapTiler © OpenStreetMap contributors";

type Env = Record<string, string | undefined>;

export type MapTilerConfig =
  | {
      readonly status: "ok";
      readonly key: string;
      readonly mapId: string;
      readonly staticApi: boolean;
    }
  | { readonly status: "unavailable" };

/** Whether a key is configured. Reads only its presence, never its value. */
export const isLocationConfigured = (env: Env): boolean =>
  (env.MAPTILER_API_KEY ?? "").trim() !== "";

/** The provider config for an action. Never pass the result to a client or a log. */
export const readMapTilerConfig = (env: Env): MapTilerConfig => {
  const key = (env.MAPTILER_API_KEY ?? "").trim();
  if (key === "") return { status: "unavailable" };
  const mapId = (env.MAPTILER_MAP_ID ?? "").trim();
  return {
    status: "ok",
    key,
    mapId: /^[A-Za-z0-9_-]{1,64}$/.test(mapId) ? mapId : DEFAULT_MAP_ID,
    staticApi: env.MAPTILER_STATIC_API?.trim().toLowerCase() === "true",
  };
};

/** A provider failure; the message never contains the request URL (it holds the key). */
export class MapTilerError extends Error {
  constructor(
    readonly reason: "http" | "network" | "invalid_response" | "too_large",
    readonly status?: number,
  ) {
    super(`maptiler ${reason}${status !== undefined ? ` ${status}` : ""}`);
  }
}

/** The most bytes a tile (or Static Maps image) may have. */
export const TILE_MAX_BYTES = 2 * 1024 * 1024;
/** The most bytes a geocoding response may have. */
export const GEOCODING_MAX_BYTES = 256 * 1024;

/**
 * GET a MapTiler URL and read at most `maxBytes` of its body. Redirects are refused (the key is
 * in the URL, and the answer must come from MapTiler itself); a declared Content-Length over the
 * cap is refused before reading, and the body is streamed and cut off at the cap otherwise.
 * Every failure is a MapTilerError carrying no URL.
 */
export const fetchMapTiler = async (
  fetchImpl: typeof fetch,
  url: string,
  { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs: number },
): Promise<Uint8Array> => {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MapTilerError("network");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new MapTilerError("http", response.status);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new MapTilerError("too_large");
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new MapTilerError("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MapTilerError) throw error;
    throw new MapTilerError("network");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

// ---- Web Mercator (EPSG:3857) on 512 px tiles: the MapLibre zoom convention ----

/** Raster tiles are requested without a tileSize segment: MapTiler then serves 512 px tiles. */
export const TILE_SIZE = 512;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;
// Mercator's latitude limit: the world square ends here.
const MAX_LAT = 85.05112878;

const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** lat/lng -> global pixel coordinates at `zoom` (origin top-left of the world square). */
export const project = (
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } => {
  const size = worldSize(zoom);
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
};

/** Global pixel coordinates at `zoom` -> lat/lng (the inverse of {@link project}). */
export const unproject = (
  x: number,
  y: number,
  zoom: number,
): { lat: number; lng: number } => {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: (x / size) * 360 - 180,
  };
};

/** Metres covered by one pixel at `lat` and `zoom`. */
export const metresPerPixel = (lat: number, zoom: number): number =>
  (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom);

export interface MapView {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

export interface TilePlacement {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Where the tile's top-left corner lands on the image (may be negative). */
  readonly left: number;
  readonly top: number;
}

/**
 * The tiles a view needs and where each lands: the image is centred on the view's lat/lng. Columns
 * wrap around the antimeridian; rows outside the world square are left out (drawn as background).
 */
export const tilesForView = (view: MapView): TilePlacement[] => {
  const center = project(view.lat, view.lng, view.zoom);
  const left = Math.round(center.x - view.width / 2);
  const top = Math.round(center.y - view.height / 2);
  const count = 2 ** view.zoom;
  const tiles: TilePlacement[] = [];
  const firstRow = Math.floor(top / TILE_SIZE);
  const lastRow = Math.floor((top + view.height - 1) / TILE_SIZE);
  const firstCol = Math.floor(left / TILE_SIZE);
  const lastCol = Math.floor((left + view.width - 1) / TILE_SIZE);
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row < 0 || row >= count) continue;
    for (let col = firstCol; col <= lastCol; col += 1) {
      tiles.push({
        z: view.zoom,
        x: ((col % count) + count) % count,
        y: row,
        left: col * TILE_SIZE - left,
        top: row * TILE_SIZE - top,
      });
    }
  }
  return tiles;
};

/** The upstream requests one render of `view` makes: its tiles, or one Static Maps image. */
export const upstreamRequestsFor = (
  config: Extract<MapTilerConfig, { status: "ok" }>,
  view: MapView,
): number => (config.staticApi ? 1 : tilesForView(view).length);

/** Where a lat/lng lands on the view's image, in image pixels. */
export const pixelInView = (
  view: MapView,
  lat: number,
  lng: number,
): { x: number; y: number } => {
  const center = project(view.lat, view.lng, view.zoom);
  const point = project(lat, lng, view.zoom);
  // The same rounded image origin tilesForView places the tiles against.
  return {
    x: point.x - Math.round(center.x - view.width / 2),
    y: point.y - Math.round(center.y - view.height / 2),
  };
};

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));

// ---- Request URLs (each carries the key: never log them) ----

export const tileUrl = (
  config: Extract<MapTilerConfig, { status: "ok" }>,
  tile: Pick<TilePlacement, "z" | "x" | "y">,
): string =>
  `${MAPTILER_ORIGIN}/maps/${config.mapId}/${tile.z}/${tile.x}/${tile.y}.png?key=${encodeURIComponent(config.key)}`;

/** One Static Maps image of the view, without MapTiler's own attribution (we draw ours). */
export const staticMapUrl = (
  config: Extract<MapTilerConfig, { status: "ok" }>,
  view: MapView,
): string =>
  `${MAPTILER_ORIGIN}/maps/${config.mapId}/static/${view.lng},${view.lat},${view.zoom}/${view.width}x${view.height}.png?attribution=false&key=${encodeURIComponent(config.key)}`;

// ---- Geocoding ----

/** The countries searched by default (the community's area). */
export const DEFAULT_SEARCH_COUNTRIES = "nl,be,de";
/** The default place types plus POIs (POIs are off unless asked for). */
export const SEARCH_TYPES =
  "municipality,municipal_district,locality,neighbourhood,place,postal_code,address,road,poi";
export const MAX_SEARCH_RESULTS = 5;
export const MAX_SEARCH_QUERY_LENGTH = 100;

export interface PlaceResult {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

export const geocodingUrl = (
  config: Extract<MapTilerConfig, { status: "ok" }>,
  request: {
    query: string;
    language?: string;
    near?: { lat: number; lng: number };
  },
): string => {
  const params = new URLSearchParams({
    key: config.key,
    country: DEFAULT_SEARCH_COUNTRIES,
    types: SEARCH_TYPES,
    limit: String(MAX_SEARCH_RESULTS),
    autocomplete: "true",
  });
  if (request.language) params.set("language", request.language);
  if (request.near) {
    params.set("proximity", `${request.near.lng},${request.near.lat}`);
  }
  return `${MAPTILER_ORIGIN}/geocoding/${encodeURIComponent(request.query)}.json?${params.toString()}`;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A geocoding response -> at most {@link MAX_SEARCH_RESULTS} `{ label, lat, lng }`. Only these
 * three fields leave: never ids, bboxes, context or any other part of the provider payload. A
 * feature without a usable name or point is skipped; a body that is not a feature collection
 * is an invalid response.
 */
export const toPlaceResults = (body: unknown): PlaceResult[] => {
  const features =
    body && typeof body === "object"
      ? (body as { features?: unknown }).features
      : undefined;
  if (!Array.isArray(features)) {
    throw new MapTilerError("invalid_response");
  }
  const results: PlaceResult[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const f = feature as {
      place_name?: unknown;
      text?: unknown;
      center?: unknown;
      geometry?: { coordinates?: unknown };
    };
    const point = Array.isArray(f.center) ? f.center : f.geometry?.coordinates;
    if (!Array.isArray(point)) continue;
    const [lng, lat] = point as unknown[];
    const label =
      typeof f.place_name === "string" && f.place_name.trim() !== ""
        ? f.place_name.trim()
        : typeof f.text === "string"
          ? f.text.trim()
          : "";
    if (
      label === "" ||
      !isFiniteNumber(lat) ||
      !isFiniteNumber(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      continue;
    }
    results.push({ label: label.slice(0, 200), lat, lng });
    if (results.length === MAX_SEARCH_RESULTS) break;
  }
  return results;
};

/** The member's preferred language as an ISO 639-1 code MapTiler ranks by, when it has one. */
export const searchLanguageOf = (
  preferredLanguage: string | undefined,
): string | undefined => {
  const code = preferredLanguage?.trim().slice(0, 2).toLowerCase();
  return code && /^[a-z]{2}$/.test(code) ? code : undefined;
};

/** An OpenStreetMap link for "Open in maps" (loaded only when tapped). */
export const openStreetMapUrl = (
  lat: number,
  lng: number,
  precision: "exact" | "approximate",
): string => {
  const zoom = precision === "exact" ? 17 : 15;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
};
