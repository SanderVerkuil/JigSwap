import { createMiddleware } from "@tanstack/react-start";

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
// (`cspNonce`, read by router.tsx through getGlobalStartContext). Server functions and server
// routes render no HTML and get none.
export const cspMiddleware = createMiddleware().server(
  async ({ next, handlerType }) => {
    const cspNonce =
      handlerType === "router" && nonceEnabled() ? createCspNonce() : undefined;
    return next({ context: { cspNonce } });
  },
);
