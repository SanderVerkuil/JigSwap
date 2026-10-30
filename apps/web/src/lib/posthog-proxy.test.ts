import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterResponseHeaders,
  forwardRequestHeaders,
  posthogUpstreamUrl,
  proxyPostHog,
} from "./posthog-proxy";

// Headers a browser and Vercel attach to a same-origin /ingest request. None
// but the allow-listed ones may reach PostHog.
const browserHeaders = {
  "content-type": "text/plain",
  accept: "*/*",
  "user-agent": "Mozilla/5.0 Test",
  "x-forwarded-for": "203.0.113.7",
  cookie: "__session=clerk-jwt; __client_uat=1",
  authorization: "Bearer secret",
  "x-vercel-oidc-token": "oidc-secret",
  "x-vercel-id": "dub1::abc",
  referer: "https://jigswap.site/members/ann?invite=tok",
  origin: "https://jigswap.site",
  host: "jigswap.site",
};

describe("posthogUpstreamUrl", () => {
  it("sends static assets to the asset host and everything else to the API host", () => {
    expect(posthogUpstreamUrl("/ingest/static/array.js", "")?.href).toBe(
      "https://eu-assets.i.posthog.com/static/array.js",
    );
    expect(posthogUpstreamUrl("/ingest/e/", "?ip=0&ver=1")?.href).toBe(
      "https://eu.i.posthog.com/e/?ip=0&ver=1",
    );
  });

  it("never leaves the PostHog host, whatever the path", () => {
    for (const path of [
      "/ingest//evil.example/x",
      "/ingest/\\evil.example/x",
      "/ingest/../../evil",
      "/ingest/static//evil.example/x",
    ]) {
      const url = posthogUpstreamUrl(path, "?a=1");
      expect(url?.protocol).toBe("https:");
      expect(["eu.i.posthog.com", "eu-assets.i.posthog.com"]).toContain(
        url?.host,
      );
    }
  });

  it("refuses paths outside /ingest/", () => {
    expect(posthogUpstreamUrl("/ingestion/e/", "")).toBeNull();
    expect(posthogUpstreamUrl("/e/", "")).toBeNull();
  });
});

describe("forwardRequestHeaders", () => {
  it("forwards only what PostHog needs: never cookies, credentials, Vercel tokens or the page URL", () => {
    const forwarded = forwardRequestHeaders(new Headers(browserHeaders));
    expect(Object.fromEntries(forwarded)).toEqual({
      "content-type": "text/plain",
      accept: "*/*",
      "user-agent": "Mozilla/5.0 Test",
      "x-forwarded-for": "203.0.113.7",
    });
  });
});

describe("filterResponseHeaders", () => {
  it("drops PostHog cookies, CORS grants, transport and encoding headers", () => {
    const filtered = filterResponseHeaders(
      new Headers({
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "retry-after": "30",
        "set-cookie": "ph=1; Domain=jigswap.site",
        "access-control-allow-origin": "https://evil.example",
        "access-control-allow-credentials": "true",
        "content-encoding": "gzip",
        "content-length": "123",
        "strict-transport-security": "max-age=1",
        connection: "keep-alive",
      }),
    );
    expect(Object.fromEntries(filtered)).toEqual({
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "retry-after": "30",
    });
  });
});

describe("proxyPostHog", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
    return { url: String(input), init: init ?? {} };
  }

  it("relays a POST batch with its query and body, but without cookies", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"status":1}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ph=1",
          "access-control-allow-origin": "https://evil.example",
          "access-control-allow-credentials": "true",
        },
      }),
    );
    const body = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff]);

    const response = await proxyPostHog(
      new Request("https://jigswap.site/ingest/e/?ip=0&compression=gzip-js", {
        method: "POST",
        headers: browserHeaders,
        body,
      }),
    );

    const { url, init } = lastCall();
    expect(url).toBe("https://eu.i.posthog.com/e/?ip=0&compression=gzip-js");
    expect(init.method).toBe("POST");
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(body);
    const sent = new Headers(init.headers);
    for (const name of [
      "cookie",
      "authorization",
      "x-vercel-oidc-token",
      "referer",
    ]) {
      expect(sent.has(name)).toBe(false);
    }

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":1}');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("fetches static assets from the asset host without a body", async () => {
    fetchMock.mockResolvedValue(new Response("//js", { status: 200 }));

    await proxyPostHog(
      new Request("https://jigswap.site/ingest/static/array.js?v=1", {
        headers: browserHeaders,
      }),
    );

    const { url, init } = lastCall();
    expect(url).toBe("https://eu-assets.i.posthog.com/static/array.js?v=1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("keeps a smuggled host on PostHog", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await proxyPostHog(
      new Request("https://jigswap.site/ingest//evil.example/x"),
    );

    expect(new URL(lastCall().url).host).toBe("eu.i.posthog.com");
  });

  it("answers 502 when PostHog cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await proxyPostHog(
      new Request("https://jigswap.site/ingest/flags/?v=2", { method: "POST" }),
    );

    expect(response.status).toBe(502);
  });
});
