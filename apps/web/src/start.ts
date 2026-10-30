import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { cspMiddleware } from "./lib/csp";
import { privateResponseMiddleware } from "./lib/response-cache";

// Server functions are same-origin RPC endpoints. Refuse (403) a call whose
// Sec-Fetch-Site, else Origin, else Referer shows another site, or that carries
// none of the three. Pages and server routes (/ingest, /sitemap.xml) stay
// reachable from links on other sites. First, so a forged call is refused
// before any session work.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Clerk requires its middleware on every request so auth() in server fns
// (see __root.tsx fetchClerkUserId) can read the session from the context.
// authorizedParties: accept only session tokens minted for this origin (their
// azp claim), so a token minted on another origin, e.g. a sibling subdomain,
// is treated as signed out. `url` is Clerk's view of the request URL (forwarded
// host and protocol), so production, previews and localhost each accept their
// own origin.
const clerk = clerkMiddleware(({ url }) => ({
  authorizedParties: [url.origin],
}));

// privateResponseMiddleware reads Clerk's session, so it runs after clerk:
// `private, no-store` on server-fn responses and signed-in pages.
// cspMiddleware gives each page render its CSP nonce (lib/csp.ts).
export const startInstance = createStart(() => ({
  requestMiddleware: [
    csrfMiddleware,
    clerk,
    privateResponseMiddleware,
    cspMiddleware,
  ],
}));
