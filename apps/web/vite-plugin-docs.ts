import fg from "fast-glob"; // fast-glob ships with vite's deps; if unresolved, `pnpm -C apps/web add -D fast-glob`
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { compileMarkdown } from "./src/docs/markdown";
import type { DocPage } from "./src/docs/types";

const VIRTUAL_ID = "virtual:docs";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/user",
);

async function loadPages(): Promise<DocPage[]> {
  const files = await fg("**/*.md", { cwd: ROOT });
  const pages: DocPage[] = [];
  for (const rel of files) {
    const raw = await fs.readFile(path.join(ROOT, rel), "utf8");
    const compiled = await compileMarkdown(raw);
    // Path layout is locale-first: <locale>/<...slug>.md (POSIX separators
    // since fast-glob emits forward slashes). First segment selects the locale;
    // the remainder forms the locale-agnostic slug.
    const parts = rel.replace(/\.md$/, "").split("/");
    const locale = parts[0];
    const rest = parts.slice(1);
    const isIndex = rest[rest.length - 1] === "index";
    const slugParts = isIndex ? rest.slice(0, -1) : rest;
    const slug = slugParts.join("/");
    const group = slug.includes("/") ? slug.split("/")[0] : slug;
    pages.push({
      locale,
      slug,
      group,
      isIndex,
      frontmatter: compiled.frontmatter,
      html: compiled.html,
      headings: compiled.headings,
      text: compiled.text,
    });
  }
  return pages;
}

export function docsPlugin(): Plugin {
  return {
    name: "jigswap-docs",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      const pages = await loadPages();
      return `export const pages = ${JSON.stringify(pages)};`;
    },
    configureServer(server) {
      const dir = ROOT;
      server.watcher.add(dir);
      const invalidate = () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("add", (f) => f.startsWith(dir) && invalidate());
      server.watcher.on("change", (f) => f.startsWith(dir) && invalidate());
      server.watcher.on("unlink", (f) => f.startsWith(dir) && invalidate());
    },
  };
}
