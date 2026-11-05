import { createMiddleware } from "@tanstack/react-start";
import { CSP_REPORT_PATH } from "./csp-report";

// The Content-Security-Policy-Report-Only every server-rendered page carries (SEC-58). Report-only:
// browsers block nothing and send each violation to /api/csp-report, so the policy can be
// checked against real traffic before it is enforced. The enforced header stays
// `frame-ancestors 'none'` alone (security-headers.ts), which report-only mode cannot carry.

// Clerk's bot protection on sign-up (Cloudflare Turnstile): a script and its iframe.
const TURNSTILE = "https://challenges.cloudflare.com";
// Clerk development instances send SDK telemetry here.
const CLERK_TELEMETRY = "https://clerk-telemetry.com";
// emojibase data for the emoji picker (frimousse) and lib/emoji-label.ts.
const EMOJI_DATA_CDN = "https://cdn.jsdelivr.net";

// A Clerk publishable key is "pk_test_" or "pk_live_" plus base64("<frontend api host>$"). The
// host is decoded rather than configured so dev, previews and production each get their own.
export function clerkFrontendApiFromPublishableKey(
  key: string | undefined,
): string | null {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key ?? "");
  if (!match) return null;
  let decoded: string;
  try {
    decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

// The Convex deployment's https and wss origins; any Convex cloud host when the URL is missing
// or odd.
function convexSources(convexUrl: string | undefined): string[] {
  try {
    const url = new URL(convexUrl ?? "");
    if (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    ) {
      return [url.origin, `wss://${url.host}`];
    }
  } catch {
    // fall through
  }
  return ["https://*.convex.cloud", "wss://*.convex.cloud"];
}

export function buildCspReportOnly(opts: {
  nonce: string;
  convexUrl?: string;
  clerkPublishableKey?: string;
}): string {
  const clerkHost = clerkFrontendApiFromPublishableKey(
    opts.clerkPublishableKey,
  );
  const clerk = clerkHost ? [`https://${clerkHost}`] : [];
  const policy: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // 'strict-dynamic': a script runs if it carries this response's nonce or was loaded by one
    // that did (route chunks, PostHog's lazy scripts, Clerk's and Turnstile's loaders). Browsers
    // that know 'strict-dynamic' ignore 'self' and the hosts; older ones use them instead.
    // 'wasm-unsafe-eval' compiles the physics engine's WebAssembly (rapier, the 3D shelf).
    [
      "script-src",
      [
        "'self'",
        `'nonce-${opts.nonce}'`,
        "'strict-dynamic'",
        "'wasm-unsafe-eval'",
        ...clerk,
        TURNSTILE,
      ],
    ],
    // React style props, Clerk's and Radix's runtime styles and the chart's <style> need inline.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // A store-page import previews the retailer's own image URL, so any https host; Convex
    // storage and Clerk avatars are https too. Photo previews are blob: URLs.
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'"]],
    // PostHog goes through /ingest on this origin. blob: for re-reading a picked photo.
    [
      "connect-src",
      [
        "'self'",
        ...convexSources(opts.convexUrl),
        ...clerk,
        CLERK_TELEMETRY,
        EMOJI_DATA_CDN,
        "blob:",
      ],
    ],
    ["frame-src", [TURNSTILE]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // report-uri only: every browser posts each violation there right away. With report-to
    // present Chromium ignores report-uri and uses a Reporting-Endpoints group instead, which it
    // never delivered to from a localhost (http) page, so that path is unverified.
    ["report-uri", [CSP_REPORT_PATH]],
  ];
  return policy
    .map(([directive, sources]) => [directive, ...sources].join(" "))
    .join("; ");
}

// A per-response nonce for the scripts SSR writes into the page: TanStack's hydration and
// module scripts (router.tsx passes it as `ssr.nonce`, which also renders a csp-nonce meta
// tag the browser-side router reads back), next-themes' theme script and Clerk's loader
// (__root.tsx). 128 random bits, base64.
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// Only production page renders get a nonce. In dev, Vite injects inline scripts of its own;
// prerendered pages (/docs) become static files that would all share one nonce.
function nonceEnabled(): boolean {
  return !import.meta.env.DEV && process.env.TSS_PRERENDERING !== "true";
}

// Request middleware: puts a fresh nonce for each page render into the request context
// (`cspNonce`, read by router.tsx through getGlobalStartContext) and sends the report-only
// policy for that nonce with the page. Server functions and server routes render no HTML and
// get neither.
export const cspMiddleware = createMiddleware().server(
  async ({ next, handlerType }) => {
    const cspNonce =
      handlerType === "router" && nonceEnabled() ? createCspNonce() : undefined;
    const result = await next({ context: { cspNonce } });
    const contentType = result.response.headers.get("content-type") ?? "";
    if (cspNonce && /^text\/html\b/i.test(contentType)) {
      result.response.headers.set(
        "content-security-policy-report-only",
        buildCspReportOnly({
          nonce: cspNonce,
          convexUrl: import.meta.env.VITE_CONVEX_URL as string | undefined,
          clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
            string | undefined,
        }),
      );
    }
    return result;
  },
);
