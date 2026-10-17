import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WhatsNewSourceFile } from "./load";

// Node-only helpers shared by the Vite plugin and the manifest spec.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const WHATS_NEW_DIR = path.join(REPO_ROOT, "docs/whats-new");
export const WHATS_NEW_MANIFEST_FILE = path.join(
  REPO_ROOT,
  "packages/contracts/src/whats-new/manifest.generated.ts",
);

// Files directly in docs/whats-new (dotfiles and subdirectories ignored). A missing directory
// means "no entries yet".
export async function readWhatsNewSourceFiles(
  dir = WHATS_NEW_DIR,
): Promise<WhatsNewSourceFile[]> {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names = dirents
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      raw: await fs.readFile(path.join(dir, name), "utf8"),
    })),
  );
}
