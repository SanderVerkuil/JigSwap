import { promises as fs } from "node:fs";
import type { Plugin } from "vite";
import { loadWhatsNewEntries, type LoadedWhatsNew } from "./src/whats-new/load";
import {
  readWhatsNewSourceFiles,
  WHATS_NEW_DIR,
  WHATS_NEW_MANIFEST_FILE,
} from "./src/whats-new/load-dir";
import {
  renderWhatsNewManifestSource,
  toWhatsNewManifest,
  WHATS_NEW_MANIFEST_COMMAND,
} from "./src/whats-new/manifest";

const VIRTUAL_ID = "virtual:whats-new";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

async function manifestMismatch(
  loaded: LoadedWhatsNew,
): Promise<string | null> {
  const expected = renderWhatsNewManifestSource(
    toWhatsNewManifest(loaded.entries),
  );
  const actual = await fs
    .readFile(WHATS_NEW_MANIFEST_FILE, "utf8")
    .catch(() => null);
  if (actual === expected) return null;
  return `[whats-new] packages/contracts/src/whats-new/manifest.generated.ts is out of date with docs/whats-new; run \`${WHATS_NEW_MANIFEST_COMMAND}\` and commit the result.`;
}

// Loads docs/whats-new/*.md into `virtual:whats-new` (see src/whats-new/load.ts) and checks that
// the backend-facing manifest in @jigswap/contracts agrees with the Markdown. A build fails on
// invalid content or a stale manifest, so a deploy never ships entries the backend doesn't know;
// the dev server only warns so authors can iterate.
export function whatsNewPlugin(): Plugin {
  let isBuild = false;
  let cache: Promise<LoadedWhatsNew> | null = null;
  const load = () =>
    (cache ??= readWhatsNewSourceFiles().then(loadWhatsNewEntries));

  return {
    name: "jigswap-whats-new",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    // Runs even when nothing imports the virtual module yet, so the check always happens.
    async buildStart() {
      try {
        const loaded = await load();
        for (const warning of loaded.warnings) this.warn(warning);
        const mismatch = await manifestMismatch(loaded);
        if (mismatch) {
          if (isBuild) this.error(mismatch);
          this.warn(mismatch);
        }
      } catch (error) {
        if (isBuild) throw error;
        this.warn((error as Error).message);
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      const { entries } = await load();
      return `export const entries = ${JSON.stringify(entries)};`;
    },
    configureServer(server) {
      server.watcher.add(WHATS_NEW_DIR);
      const onChange = (file: string) => {
        if (!file.startsWith(WHATS_NEW_DIR)) return;
        cache = null;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
        load()
          .then(manifestMismatch)
          .then((mismatch) => mismatch && server.config.logger.warn(mismatch))
          .catch((error: Error) => server.config.logger.warn(error.message));
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
