import { writeFileSync } from "node:fs";
import { intToRGBA, Jimp } from "jimp";
import { describe, expect, test, vi } from "vitest";
import { attributionWidth, renderMap } from "./conversation/adapters/mapRender";
import {
  DEFAULT_MAP_ID,
  fetchMapTiler,
  geocodingUrl,
  isLocationConfigured,
  MapTilerError,
  openStreetMapUrl,
  pixelInView,
  project,
  readMapTilerConfig,
  searchLanguageOf,
  tilesForView,
  toPlaceResults,
  unproject,
} from "./conversation/adapters/mapTiler";

// The MapTiler adapter: config, Web Mercator math, URLs, the geocoding mapping and the renderer
// (with a fake fetch serving generated tiles). MAP_RENDER_OUT=<dir> writes the rendered PNGs there
// for a visual check.

const config = {
  status: "ok" as const,
  key: "test-key",
  mapId: DEFAULT_MAP_ID,
  staticApi: false,
};

// A solid 512 px tile whose colour encodes its x/y, as PNG bytes.
const tilePng = async (x: number, y: number, size = 512) => {
  const image = new Jimp({
    width: size,
    height: size,
    color: ((((x * 40) % 200) << 24) | (((y * 40) % 200) << 16) | 0xa0ff) >>> 0,
  });
  return new Uint8Array(await image.getBuffer("image/png"));
};

const tileFetch = (size = 512) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!match) return new Response("not found", { status: 404 });
    return new Response(
      await tilePng(Number(match[2]), Number(match[3]), size),
      {
        headers: { "content-type": "image/png" },
      },
    );
  });

const out = (name: string, bytes: Uint8Array) => {
  const dir = process.env.MAP_RENDER_OUT;
  if (dir) writeFileSync(`${dir}/${name}`, bytes);
};

describe("config", () => {
  test("no key: unavailable; presence only for the feature probe", () => {
    expect(readMapTilerConfig({})).toEqual({ status: "unavailable" });
    expect(readMapTilerConfig({ MAPTILER_API_KEY: "  " })).toEqual({
      status: "unavailable",
    });
    expect(isLocationConfigured({})).toBe(false);
    expect(isLocationConfigured({ MAPTILER_API_KEY: "k" })).toBe(true);
  });

  test("defaults the map id, rejects a malformed one, reads the static flag", () => {
    expect(readMapTilerConfig({ MAPTILER_API_KEY: "k" })).toEqual({
      status: "ok",
      key: "k",
      mapId: "streets-v4",
      staticApi: false,
    });
    expect(
      readMapTilerConfig({
        MAPTILER_API_KEY: "k",
        MAPTILER_MAP_ID: "../evil?x=",
        MAPTILER_STATIC_API: "TRUE",
      }),
    ).toMatchObject({ mapId: "streets-v4", staticApi: true });
    expect(
      readMapTilerConfig({
        MAPTILER_API_KEY: "k",
        MAPTILER_MAP_ID: "basic-v2",
      }),
    ).toMatchObject({ mapId: "basic-v2", staticApi: false });
  });
});

describe("Web Mercator", () => {
  test("project and unproject are inverses", () => {
    for (const [lat, lng, zoom] of [
      [52.3731, 4.8922, 15],
      [-33.86, 151.2, 3],
      [0, 0, 10],
    ]) {
      const { x, y } = project(lat, lng, zoom);
      const back = unproject(x, y, zoom);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });

  test("zoom 0 is one 512 px world tile", () => {
    expect(project(0, 0, 0)).toEqual({ x: 256, y: 256 });
    expect(project(85.05112878, -180, 0).y).toBeCloseTo(0, 6);
  });

  test("a 600x360 view needs at most 2x2 or 3x2 tiles, centred on the location", () => {
    const view = {
      lat: 52.3731,
      lng: 4.8922,
      zoom: 15,
      width: 600,
      height: 360,
    };
    const tiles = tilesForView(view);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    expect(tiles.length).toBeLessThanOrEqual(6);
    // Every image pixel is covered by exactly the listed tiles.
    for (const tile of tiles) {
      expect(tile.left).toBeLessThan(view.width);
      expect(tile.top).toBeLessThan(view.height);
      expect(tile.left + 512).toBeGreaterThan(0);
      expect(tile.top + 512).toBeGreaterThan(0);
    }
    const centre = pixelInView(view, view.lat, view.lng);
    expect(centre.x).toBeCloseTo(300, 0);
    expect(centre.y).toBeCloseTo(180, 0);
  });

  test("columns wrap at the antimeridian; rows outside the world are skipped", () => {
    const tiles = tilesForView({
      lat: 0,
      lng: 179.99,
      zoom: 3,
      width: 600,
      height: 360,
    });
    expect(tiles.some((t) => t.x === 0)).toBe(true);
    expect(tiles.some((t) => t.x === 7)).toBe(true);
    const polar = tilesForView({
      lat: 85,
      lng: 0,
      zoom: 3,
      width: 600,
      height: 360,
    });
    expect(polar.every((t) => t.y >= 0)).toBe(true);
  });
});

describe("geocoding", () => {
  test("the request: query, countries, POIs, limit, language and lng,lat proximity", () => {
    const url = new URL(
      geocodingUrl(config, {
        query: "Centraal Station / Utrecht",
        language: "nl",
        near: { lat: 52.09, lng: 5.11 },
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://api.maptiler.com/geocoding/Centraal%20Station%20%2F%20Utrecht.json",
    );
    expect(url.searchParams.get("country")).toBe("nl,be,de");
    expect(url.searchParams.get("types")).toContain("poi");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("language")).toBe("nl");
    expect(url.searchParams.get("proximity")).toBe("5.11,52.09");
  });

  test("maps features to label/lat/lng only, at most 5, skipping unusable ones", () => {
    const feature = (i: number) => ({
      id: `poi.${i}`,
      type: "Feature",
      text: `Place ${i}`,
      place_name: `Place ${i}, Utrecht, Nederland`,
      center: [5.1 + i / 100, 52.09],
      geometry: { type: "Point", coordinates: [5.1 + i / 100, 52.09] },
      bbox: [5, 52, 5.2, 52.2],
      properties: { ref: "secret", categories: ["cafe"] },
      context: [{ id: "country.1", text: "Nederland" }],
    });
    const results = toPlaceResults({
      type: "FeatureCollection",
      attribution: "<a>MapTiler</a>",
      query: ["place"],
      features: [
        { text: "", center: [1, 2] },
        { place_name: "No point" },
        { place_name: "Out of range", center: [200, 10] },
        ...[0, 1, 2, 3, 4, 5, 6].map(feature),
      ],
    });
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      label: "Place 0, Utrecht, Nederland",
      lat: 52.09,
      lng: 5.1,
    });
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["label", "lat", "lng"]);
    }
  });

  test("a body that is not a feature collection is an invalid response", () => {
    expect(() => toPlaceResults({ message: "Invalid key" })).toThrow(
      MapTilerError,
    );
  });

  test("language and the OSM link", () => {
    expect(searchLanguageOf("nl-NL")).toBe("nl");
    expect(searchLanguageOf(undefined)).toBeUndefined();
    expect(searchLanguageOf("1x")).toBeUndefined();
    expect(openStreetMapUrl(52.3731, 4.8922, "exact")).toBe(
      "https://www.openstreetmap.org/?mlat=52.3731&mlon=4.8922#map=17/52.3731/4.8922",
    );
    expect(openStreetMapUrl(52.37, 4.89, "approximate")).toContain("#map=15/");
  });
});

describe("renderMap", () => {
  const view = { lat: 52.3731, lng: 4.8922, zoom: 15, width: 600, height: 300 };

  test("composes the view's tiles once each, draws the pin and the attribution", async () => {
    const fetchImpl = tileFetch();
    const png = await renderMap(
      config,
      view,
      { lat: view.lat, lng: view.lng, style: "pin" },
      fetchImpl as unknown as typeof fetch,
    );
    out("map-pin.png", png);
    const tiles = tilesForView(view);
    expect(fetchImpl).toHaveBeenCalledTimes(tiles.length);
    for (const [input] of fetchImpl.mock.calls) {
      expect(String(input)).toMatch(
        /^https:\/\/api\.maptiler\.com\/maps\/streets-v4\/15\/\d+\/\d+\.png\?key=test-key$/,
      );
    }
    const image = await Jimp.read(Buffer.from(png));
    expect(image.bitmap.width).toBe(600);
    expect(image.bitmap.height).toBe(300);
    // The pin's red disc sits just above the centre.
    const pin = intToRGBA(image.getPixelColor(300 + 8, 150 - 20));
    expect(pin).toMatchObject({ r: 225, g: 29, b: 72 });
    // The attribution strip: a light box with dark glyph pixels, bottom-right.
    const strip = { left: 600 - attributionWidth() - 4, top: 300 - 14 - 4 };
    let dark = 0;
    for (let y = strip.top; y < 300 - 4; y += 1) {
      for (let x = strip.left; x < 600 - 4; x += 1) {
        const { r } = intToRGBA(image.getPixelColor(x, y));
        if (r < 80) dark += 1;
      }
    }
    expect(dark).toBeGreaterThan(200);
    expect(attributionWidth()).toBeLessThan(560);
  });

  test("an approximate location draws a shaded area, not a pin", async () => {
    const png = await renderMap(
      config,
      { ...view, zoom: 12 },
      { lat: view.lat, lng: view.lng, style: "area", radiusMetres: 800 },
      tileFetch() as unknown as typeof fetch,
    );
    out("map-area.png", png);
    const image = await Jimp.read(Buffer.from(png));
    const centre = intToRGBA(image.getPixelColor(300, 150));
    expect(centre).not.toMatchObject({ r: 225, g: 29, b: 72 });
  });

  test("a provider error fails with its status only, never the URL or key", async () => {
    const failing = vi.fn(async () => new Response("denied", { status: 403 }));
    const error = await renderMap(
      config,
      view,
      { lat: view.lat, lng: view.lng, style: "pin" },
      failing as unknown as typeof fetch,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MapTilerError);
    expect((error as MapTilerError).status).toBe(403);
    expect(String((error as Error).message)).not.toContain("test-key");
    expect(String((error as Error).message)).not.toContain("https://");
  });

  test("a tile of the wrong size is an invalid response", async () => {
    await expect(
      renderMap(
        config,
        view,
        { lat: view.lat, lng: view.lng, style: "pin" },
        tileFetch(256) as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });

  test("MAPTILER_STATIC_API: one Static Maps request without MapTiler's own attribution", async () => {
    const fetchImpl = vi.fn(async () => {
      const image = new Jimp({ width: 600, height: 300, color: 0x88aa88ff });
      return new Response(new Uint8Array(await image.getBuffer("image/png")));
    });
    const png = await renderMap(
      { ...config, staticApi: true },
      view,
      { lat: view.lat, lng: view.lng, style: "pin" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.maptiler.com/maps/streets-v4/static/4.8922,52.3731,15/600x300.png?attribution=false&key=test-key",
    );
    const image = await Jimp.read(Buffer.from(png));
    expect(image.bitmap.width).toBe(600);
  });
});

describe("fetchMapTiler", () => {
  const opts = { maxBytes: 1000, timeoutMs: 1000 };

  test("refuses redirects and returns the body under the cap", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(10)));
    const bytes = await fetchMapTiler(
      fetchImpl as unknown as typeof fetch,
      "https://api.maptiler.com/x?key=k",
      opts,
    );
    expect(bytes.byteLength).toBe(10);
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({
      redirect: "error",
    });
  });

  test("a declared Content-Length over the cap is refused before reading", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array(10), {
          headers: { "content-length": "5000" },
        }),
    );
    await expect(
      fetchMapTiler(fetchImpl as unknown as typeof fetch, "u", opts),
    ).rejects.toMatchObject({ reason: "too_large" });
  });

  test("an undeclared body is cut off at the cap while streaming", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(400));
        if (pulled > 50) controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream));
    await expect(
      fetchMapTiler(fetchImpl as unknown as typeof fetch, "u", opts),
    ).rejects.toMatchObject({ reason: "too_large" });
    expect(pulled).toBeLessThan(10);
  });

  test("a redirect (rejected by fetch) or network failure is 'network', with no URL", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed: redirect https://evil.test/?key=k");
    });
    const error = await fetchMapTiler(
      fetchImpl as unknown as typeof fetch,
      "https://api.maptiler.com/x?key=k",
      opts,
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "network" });
    expect(String(error)).not.toContain("key=k");
  });

  test("an oversized tile fails the render cleanly", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array(10), {
          headers: { "content-length": String(3 * 1024 * 1024) },
        }),
    );
    await expect(
      renderMap(
        config,
        { lat: 52, lng: 5, zoom: 15, width: 600, height: 300 },
        { lat: 52, lng: 5, style: "pin" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "too_large" });
  });
});
