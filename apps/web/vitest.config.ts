import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const DOCS_STUBS: Record<string, string> = {
  "virtual:docs": "export const pages = [];",
  "virtual:docs/content": "export const pageLoaders = {};",
  "virtual:docs/search": "export const searchLoaders = {};",
};

// Standalone vitest config: the app's vite.config.ts pulls in TanStack
// Start/nitro plugins that must not run under vitest. Vitest prefers
// vitest.config.ts over vite.config.ts automatically.
export default defineConfig({
  root: __dirname,
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // The real docs plugin isn't loaded here. Component tests vi.mock these modules
    // with their own pages, and for that they only have to resolve.
    {
      name: "virtual-docs-stub",
      resolveId: (id) => (id in DOCS_STUBS ? `\0${id}` : null),
      load: (id) => (id[0] === "\0" ? DOCS_STUBS[id.slice(1)] : null),
    },
  ],
  test: {
    watch: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default"],
  },
});
