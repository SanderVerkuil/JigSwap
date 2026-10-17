import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/domain",
  test: {
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/domain",
      provider: "v8" as const,
      // json-summary feeds the totals shown in the CI reports PR comment.
      reporter: ["text", "html", "json-summary"],
    },
  },
}));
