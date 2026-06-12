import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/backend",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  test: {
    watch: false,
    globals: true,
    // convex-test runs the Convex JS runtime; edge-runtime provides the matching globals.
    environment: "edge-runtime",
    // Drain scheduled (event-dispatch) functions after each test so fire-and-forget jobs don't
    // leak past teardown. See test-setup.ts.
    setupFiles: ["./test-setup.ts"],
    // The afterEach drain is best-effort; under slow CI a fire-and-forget scheduled job can still
    // run after its test, making convex-test throw "Write outside of transaction" on its
    // _scheduled_functions status write. That rejection is unhandled (the job is never awaited), so
    // vitest would fail an otherwise all-green run. Assertions are what matter here; ignore it.
    dangerouslyIgnoreUnhandledErrors: true,
    // CI runs `nx run-many --parallel=4`, so vitest shares the runner with other projects'
    // lint/build; convex-test's per-test module bundling then pushes tests that take ~500ms
    // locally past the 5s default timeout.
    testTimeout: 20_000,
    server: { deps: { inline: ["convex-test"] } },
    include: [
      "convex/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/backend",
      provider: "v8" as const,
      // json-summary feeds the totals shown in the CI reports PR comment.
      reporter: ["text", "html", "json-summary"],
    },
  },
}));
