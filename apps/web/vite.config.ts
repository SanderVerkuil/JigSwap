import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { docsPlugin } from "./vite-plugin-docs";

// root pinned to this dir so Vite resolves config/paths from the app, not the
// monorepo root, when Nx invokes the build from a different cwd.
export default defineConfig({
  root: __dirname,
  server: { port: 3001 },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    docsPlugin(),
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
        // Clerk/Convex env in CI) is skipped and served via SSR instead of
        // failing the build. With real env the docs render to static HTML.
        failOnError: false,
        crawlLinks: true,
        filter: (page: { path: string }) => page.path.startsWith("/docs"),
      },
    }),
    viteReact(),
    // Reverse-proxy PostHog through /ingest (the paths posthog-provider.tsx targets),
    // replacing the next.config rewrites; static assets first as the more specific rule.
    nitro({
      routeRules: {
        "/ingest/static/**": {
          proxy: { to: "https://eu-assets.i.posthog.com/static/**" },
        },
        "/ingest/**": { proxy: { to: "https://eu.i.posthog.com/**" } },
      },
    }),
    // Bundle treemap for CI reports, opt-in via ANALYZE=1 so dev/prod builds
    // are untouched. TanStack Start runs one Rollup build per environment;
    // applyToEnvironment keeps the report scoped to the client bundle instead
    // of letting the last (SSR/server) build overwrite it.
    // NOTE: an ANALYZE build must bypass the Nx cache (Nx doesn't key on this
    // env var) — CI runs `vite build` directly instead of `nx build web`.
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
