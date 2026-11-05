import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Standalone vitest config: the app's vite.config.ts pulls in TanStack
// Start/nitro plugins that must not run under vitest. Vitest prefers
// vitest.config.ts over vite.config.ts automatically.
export default defineConfig({
  root: __dirname,
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // The real docs plugin isn't loaded here. Component tests vi.mock this module
    // with their own pages, and for that it only has to resolve.
    {
      name: "virtual-docs-stub",
      resolveId: (id) => (id === "virtual:docs" ? "\0virtual:docs" : null),
      load: (id) =>
        id === "\0virtual:docs" ? "export const pages = [];" : null,
    },
  ],
  test: {
    watch: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default"],
  },
});
