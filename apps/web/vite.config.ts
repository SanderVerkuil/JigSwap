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
  build: {
    // Fonts are always served as files. Hanken Grotesk's cyrillic-ext face is under Vite's 4 KB
    // inline limit, so it was built into globals.css as a data: URI and every route paid 2.2 KB of
    // CSS for a face that only loads if its unicode-range is on the page. Other assets keep
    // Vite's default.
    assetsInlineLimit: (file: string) =>
      /\.(woff2?|ttf|otf)$/.test(file) ? false : undefined,
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    docsPlugin(),
    whatsNewPlugin(),
    appVersionPlugin(),
    // Nothing is prerendered, the docs included: one static HTML file per URL can only be in one
    // language, and the URLs don't carry a locale yet (P-24), so Dutch visitors opening a docs URL
    // got the English guide. SSR picks the visitor's language on every request; the docs read
    // nothing from Convex at load, so it stays cheap. Bring prerendering back with locale URLs.
    tanstackStart({ srcDirectory: "src" }),
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
