import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWhatsNewEntries } from "./load";
import { readWhatsNewSourceFiles, WHATS_NEW_MANIFEST_FILE } from "./load-dir";
import { renderWhatsNewManifestSource, toWhatsNewManifest } from "./manifest";
import type { WhatsNewEntry } from "./types";

const entry = (over: Partial<WhatsNewEntry>): WhatsNewEntry => ({
  id: "x",
  publishedAt: 1,
  category: "feature",
  highlight: false,
  notify: false,
  content: {
    en: { title: "T", summary: "S", html: "<p>B</p>", fallback: false },
    nl: { title: "T", summary: "S", html: "<p>B</p>", fallback: true },
  },
  ...over,
});

describe("toWhatsNewManifest", () => {
  it("keeps only the locale-invariant metadata the backend needs, in order", () => {
    expect(
      toWhatsNewManifest([
        entry({
          id: "b",
          publishedAt: 2,
          highlight: true,
          tour: "b-tour",
          image: "/x.png",
          ctaTo: "/library",
        }),
        entry({ id: "a", notify: true }),
      ]),
    ).toEqual([
      {
        id: "b",
        publishedAt: 2,
        highlight: true,
        notify: false,
        tour: "b-tour",
      },
      { id: "a", publishedAt: 1, highlight: false, notify: true },
    ]);
  });
});

describe("renderWhatsNewManifestSource", () => {
  it("renders an importable, stable module", () => {
    const manifest = [
      { id: "a", publishedAt: 1, highlight: false, notify: true },
    ];
    const source = renderWhatsNewManifestSource(manifest);
    expect(source).toBe(renderWhatsNewManifestSource(manifest));
    expect(source).toContain(
      'export const WHATS_NEW_MANIFEST: readonly WhatsNewManifestEntry[] = [\n  {\n    "id": "a",',
    );
    expect(source.endsWith("];\n")).toBe(true);
  });
});

describe("readWhatsNewSourceFiles", () => {
  it("treats a missing directory as no entries", async () => {
    expect(
      await readWhatsNewSourceFiles(
        path.join(os.tmpdir(), "no-such-whats-new"),
      ),
    ).toEqual([]);
  });

  it("reads files sorted by name, skipping dotfiles and directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "whats-new-"));
    await fs.writeFile(path.join(dir, "b.en.md"), "B");
    await fs.writeFile(path.join(dir, "a.en.md"), "A");
    await fs.writeFile(path.join(dir, ".DS_Store"), "");
    await fs.mkdir(path.join(dir, "images"));
    expect(await readWhatsNewSourceFiles(dir)).toEqual([
      { name: "a.en.md", raw: "A" },
      { name: "b.en.md", raw: "B" },
    ]);
    await fs.rm(dir, { recursive: true });
  });
});

// The agreement check: the committed backend-facing manifest must describe exactly the Markdown
// in docs/whats-new. On a mismatch, regenerate with `pnpm --filter @jigswap/web
// whats-new:manifest` (this spec with -u). The Vite plugin repeats the check at build time.
describe("committed manifest", () => {
  it("matches docs/whats-new", async () => {
    const { entries } = await loadWhatsNewEntries(
      await readWhatsNewSourceFiles(),
    );
    await expect(
      renderWhatsNewManifestSource(toWhatsNewManifest(entries)),
    ).toMatchFileSnapshot(WHATS_NEW_MANIFEST_FILE);
  }, 60000);
});
