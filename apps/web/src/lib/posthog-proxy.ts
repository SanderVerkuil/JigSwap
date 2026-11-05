// Same-origin reverse proxy for PostHog (analytics-client.ts sets api_host "/ingest"), served by
// routes/ingest/$.ts. It runs as a function, not a CDN rewrite: a rewrite forwards every request
// header, the Clerk session cookie included, and passes PostHog's credentialed CORS and cookies
// back on our origin. Both directions are allow-lists, so a new header is dropped until added.

const PREFIX = "/ingest/";
const API_HOST = "eu.i.posthog.com";
const ASSET_HOST = "eu-assets.i.posthog.com";
const UPSTREAM_TIMEOUT_MS = 10_000;

// What PostHog needs: the payload type, the client's user agent, and the client IP (Vercel sets
// x-forwarded-for) for GeoIP, as the CDN rewrite did. Never cookie, authorization, referer
// (the full page URL) or Vercel's x-vercel-* headers such as the OIDC token.
const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "user-agent",
  "x-forwarded-for",
];

// posthog-js reads only Retry-After; the rest keeps caching of the static scripts working.
// set-cookie, access-control-*, strict-transport-security and the encoding/length headers
// (fetch has already decoded the body) never pass.
const RETURNED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "vary",
  "retry-after",
];

// Maps /ingest/<path> to PostHog's EU hosts. The host is fixed and the path is set through the
// URL's pathname, so "/ingest//evil.example" stays a path on PostHog.
export function posthogUpstreamUrl(
  pathname: string,
  search: string,
): URL | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const path = pathname.slice(PREFIX.length - 1);
  const host = path.startsWith("/static/") ? ASSET_HOST : API_HOST;
  const url = new URL(`https://${host}`);
  url.pathname = path;
  url.search = search;
  return url;
}

function pick(headers: Headers, names: readonly string[]): Headers {
  const picked = new Headers();
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) picked.set(name, value);
  }
  return picked;
}

export function forwardRequestHeaders(headers: Headers): Headers {
  return pick(headers, FORWARDED_REQUEST_HEADERS);
}

export function filterResponseHeaders(headers: Headers): Headers {
  return pick(headers, RETURNED_RESPONSE_HEADERS);
}

export async function proxyPostHog(request: Request): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const upstream = posthogUpstreamUrl(pathname, search);
  if (!upstream) return new Response(null, { status: 404 });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers: forwardRequestHeaders(request.headers),
      // Analytics batches are small; buffering avoids streaming-body quirks.
      body: hasBody ? await request.arrayBuffer() : undefined,
      // A hung upstream must not keep the function (and its bill) running.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: filterResponseHeaders(response.headers),
  });
}
