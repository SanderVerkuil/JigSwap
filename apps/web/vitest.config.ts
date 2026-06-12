import tsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Standalone vitest config: the app's vite.config.ts pulls in TanStack
// Start/nitro plugins that must not run under vitest. Vitest prefers
// vitest.config.ts over vite.config.ts automatically.
export default defineConfig({
  root: __dirname,
  plugins: [tsConfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    watch: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default"],
  },
});
