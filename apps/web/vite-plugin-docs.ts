import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob"; // fast-glob ships with vite's deps; if unresolved, `pnpm -C apps/web add -D fast-glob`

import type { Plugin } from "vite";
import { compileMarkdown } from "./src/docs/markdown";
import type { DocPage } from "./src/docs/types";
import {
  docPageFromFile,
  isDocsModule,
  renderDocsModule,
} from "./src/docs/virtual-modules";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/user",
);

async function loadPages(): Promise<DocPage[]> {
  const files = await fg("**/*.md", { cwd: ROOT });
  const pages: DocPage[] = [];
  for (const rel of files) {
    const raw = await fs.readFile(path.join(ROOT, rel), "utf8");
    pages.push(docPageFromFile(rel, await compileMarkdown(raw)));
  }
  return pages;
}

// Compiles docs/user/**/*.md into the `virtual:docs*` modules described in
// src/docs/virtual-modules.ts: page metadata, a lazy body per page and a lazy
// search corpus per locale. Compiled once and shared by every module.
export function docsPlugin(): Plugin {
  let cache: Promise<DocPage[]> | null = null;
  return {
    name: "jigswap-docs",
    resolveId(id) {
      if (isDocsModule(id)) return "\0" + id;
    },
    async load(id) {
      if (!id.startsWith("\0") || !isDocsModule(id.slice(1))) return;
      const source = renderDocsModule(
        id.slice(1),
        await (cache ??= loadPages()),
      );
      if (source === null) this.error(`Unknown docs module: ${id.slice(1)}`);
      return source;
    },
    configureServer(server) {
      const dir = ROOT;
      server.watcher.add(dir);
      const invalidate = (file: string) => {
        if (!file.startsWith(dir)) return;
        cache = null;
        for (const environment of Object.values(server.environments)) {
          const graph = environment.moduleGraph;
          for (const [id, mod] of graph.idToModuleMap) {
            if (id.startsWith("\0") && isDocsModule(id.slice(1))) {
              graph.invalidateModule(mod);
            }
          }
        }
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("change", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}
