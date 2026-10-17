// Writes src/routeTree.gen.ts (gitignored) without a full build: resolving the Vite
// config runs the TanStack Start plugin, which generates the route tree. type-check
// needs that file, and must not depend on a build or test having run first.
import { resolveConfig } from "vite";

await resolveConfig(
  {
    configFile: new URL("./vite.config.ts", import.meta.url).pathname,
    logLevel: "error",
  },
  "build",
);
