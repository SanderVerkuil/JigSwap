import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// root pinned to this dir so Vite resolves config/paths from the app, not the
// monorepo root, when Nx invokes the build from a different cwd.
export default defineConfig({
  root: __dirname,
  server: { port: 3001 },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({ srcDirectory: "src" }),
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
  ],
});
