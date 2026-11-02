// Response headers every page, asset and prerendered doc carries (SEC-58). vite.config.ts
// spreads them into each nitro `headers` route rule: nitro applies them at runtime to SSR,
// server-function and server-route responses, and turns them into Vercel CDN routes for static
// files. Vercel stops at the first matching CDN route, so every rule with its own headers must
// spread these too.
//
// The Content-Security-Policy here carries only frame-ancestors, which report-only mode ignores;
// the full policy is rolled out report-only first.
export const SECURITY_HEADERS = {
  // Replaces Vercel's default (max-age only). includeSubDomains assumes every *.jigswap.site
  // host serves HTTPS; no preload until the domain set is settled.
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  // Same-origin requests keep the full Referer (CSRF origin checks fall back on it);
  // cross-site requests get the origin only.
  "referrer-policy": "strict-origin-when-cross-origin",
  // geolocation for the messaging location picker, camera for the catalogue search's barcode
  // scanner; nothing uses mic, payment or USB.
  "permissions-policy":
    "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()",
  // No page may be framed (clickjacking). X-Frame-Options for older browsers.
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
} as const;
