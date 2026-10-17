import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/contracts",
  plugins: [nxViteTsPaths()],
  test: {
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    reporters: ["default"],
  },
}));
