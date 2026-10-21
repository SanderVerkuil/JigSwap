import type { Plugin } from "vite";

// One id per build: the deployed commit on Vercel, else the build time. Computed once per process
// so the client, SSR and server environments of a single `vite build` agree.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || `${Date.now()}`;

// Bakes the build id into the bundle as __APP_VERSION__ and publishes the same id at
// /version.json, so an open tab can notice a newer deploy (see src/lib/app-version.ts). The file
// is served uncached via a nitro route rule in vite.config.ts.
export function appVersionPlugin(): Plugin {
  return {
    name: "jigswap-app-version",
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(BUILD_ID) } }),
    generateBundle() {
      // The client build's assets land in the public output, next to the hashed chunks.
      if (this.environment.name !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: BUILD_ID }),
      });
    },
  };
}
