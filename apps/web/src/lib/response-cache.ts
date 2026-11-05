import { createMiddleware } from "@tanstack/react-start";

export const PRIVATE_NO_STORE = "private, no-store";

/**
 * The Cache-Control a Start response must carry so that no shared cache (Vercel's CDN, a proxy)
 * and no disk cache keeps one person's response, or null to leave the response's own header.
 * - Server functions: always, signed in or not. Each answers one visitor's cookies (user id,
 *   admin status, locale).
 * - Signed-in pages (HTML, including 404/error pages) and their redirects: SSR dehydrates the
 *   member's Convex query results into the page.
 * Signed-out pages and server routes (/ingest, /sitemap.xml, /robots.txt) keep their own headers,
 * so public pages and PostHog's script stay cacheable.
 */
export function authResponseCacheControl(opts: {
  handlerType: "serverFn" | "router";
  signedIn: boolean;
  status: number;
  contentType: string | null;
}): string | null {
  if (opts.handlerType === "serverFn") return PRIVATE_NO_STORE;
  if (!opts.signedIn) return null;
  const isPage = /^text\/html\b/i.test(opts.contentType ?? "");
  const isRedirect = opts.status >= 300 && opts.status < 400;
  return isPage || isRedirect ? PRIVATE_NO_STORE : null;
}

// Put into the request context by Clerk's middleware, which start.ts runs before this one. Start
// types a dependency-free middleware's context as undefined, hence `unknown` below.
type ClerkRequestContext = {
  auth?: (opts: {
    treatPendingAsSignedOut: boolean;
  }) => { userId: string | null } | Promise<{ userId: string | null }>;
};

// Any session counts, pending ones too; without Clerk's context, assume one (fail closed).
async function hasSession(context: unknown): Promise<boolean> {
  const auth = (context as ClerkRequestContext | undefined)?.auth;
  if (!auth) return true;
  const { userId } = await auth({ treatPendingAsSignedOut: false });
  return userId !== null;
}

// Request middleware: applies authResponseCacheControl to the finished response. Must run after
// Clerk's middleware (start.ts).
export const privateResponseMiddleware = createMiddleware().server(
  async ({ next, context, handlerType }) => {
    const signedIn = await hasSession(context);
    const result = await next();
    const cacheControl = authResponseCacheControl({
      handlerType,
      signedIn,
      status: result.response.status,
      contentType: result.response.headers.get("content-type"),
    });
    if (cacheControl)
      result.response.headers.set("cache-control", cacheControl);
    return result;
  },
);
