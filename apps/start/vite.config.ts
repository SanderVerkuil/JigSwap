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
    nitro(),
  ],
});
