import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { SECURITY_HEADERS } from "./src/lib/security-headers";
import { appVersionPlugin } from "./vite-plugin-app-version";
import { docsPlugin } from "./vite-plugin-docs";
import { whatsNewPlugin } from "./vite-plugin-whats-new";

// Absolute origin for share previews (og:url, og:image; src/lib/seo-head.ts). Vercel provides the
// production domain at build time; elsewhere it stays unset and those tags are left out, so no
// domain is hard-coded in the repo.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

// root pinned to this dir so Vite resolves config/paths from the app, not the
// monorepo root, when the build is invoked from a different cwd.
export default defineConfig({
  root: __dirname,
  server: { port: 3001 },
  define: productionHost
    ? {
        "import.meta.env.VITE_SITE_ORIGIN": JSON.stringify(
          `https://${productionHost}`,
        ),
      }
    : {},
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    docsPlugin(),
    whatsNewPlugin(),
    appVersionPlugin(),
    // Statically prerender the public docs to HTML at build time. We seed the
    // crawler at /docs and let it follow the sidebar/TOC links; the filter keeps
    // prerendering scoped to /docs/* so the authenticated app is never rendered
    // without a session. Public docs don't read Convex at load, and root auth
    // falls back to unauthenticated during prerender (see __root.tsx).
    tanstackStart({
      srcDirectory: "src",
      pages: [{ path: "/docs", prerender: { enabled: true } }],
      prerender: {
        enabled: true,
        // Best-effort: a page that can't be rendered at build time (e.g. no
        // Clerk/Convex env) is skipped and served via SSR instead of failing
        // the build. With env set the docs render to static HTML; bundle:check
        // fails on a build that prerendered none.
        failOnError: false,
        crawlLinks: true,
        filter: (page: { path: string }) => page.path.startsWith("/docs"),
      },
    }),
    viteReact(),
    // PostHog's /ingest proxy is a server route (src/routes/ingest/$.ts), not a proxy route rule:
    // on Vercel those become CDN rewrites that forward the Clerk cookie and pass PostHog's
    // credentialed CORS back.
    nitro({
      routeRules: {
        // Security headers on every response: SSR, server functions and static files alike.
        "/**": { headers: SECURITY_HEADERS },
        // Hashed build assets. Nitro would add only this cache-control rule for them, which on
        // Vercel would shadow the /** headers; spelled out so they keep both.
        "/assets/**": {
          headers: {
            ...SECURITY_HEADERS,
            "cache-control": "public, max-age=31536000, immutable",
          },
        },
        // The deployed build id open tabs poll (vite-plugin-app-version.ts); never cached, or
        // a tab would keep seeing the old id after a deploy. Vercel applies only the first
        // matching headers rule, so this one repeats the security headers.
        "/version.json": {
          headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
        },
      },
      // Run SSR and server functions in Dublin, next to the Convex deployment (AWS eu-west-1).
      // Unpinned, Vercel ran them in Washington (iad1): every SSR query crossed the Atlantic and
      // signed-in member data was rendered outside the EU. Nitro writes this into the
      // function's .vc-config.json.
      vercel: { functions: { regions: ["dub1"] } },
    }),
    // Bundle treemap for CI reports, opt-in via ANALYZE=1 so dev/prod builds
    // are untouched. TanStack Start runs one Rollup build per environment;
    // applyToEnvironment keeps the report scoped to the client bundle instead
    // of letting the last (SSR/server) build overwrite it.
    // NOTE: an ANALYZE build must bypass the task cache (turbo.json doesn't key
    // on this env var) — CI runs `vite build` directly instead of `turbo run build`.
    !!process.env.ANALYZE && {
      ...visualizer({
        filename: "stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
      }),
      applyToEnvironment: (environment: { name: string }) =>
        environment.name === "client",
    },
  ],
});
