import type { WhatsNewManifestEntry } from "@jigswap/contracts";
import type { WhatsNewEntry } from "./types";

export const WHATS_NEW_MANIFEST_COMMAND =
  "pnpm --filter @jigswap/web whats-new:manifest";

// The locale-invariant metadata the backend needs, in entry order (newest first).
export const toWhatsNewManifest = (
  entries: readonly WhatsNewEntry[],
): WhatsNewManifestEntry[] =>
  entries.map((entry) => ({
    id: entry.id,
    publishedAt: entry.publishedAt,
    highlight: entry.highlight,
    notify: entry.notify,
    ...(entry.tour ? { tour: entry.tour } : {}),
  }));

// Source text of packages/contracts/src/whats-new/manifest.generated.ts. The file is
// prettier-ignored, so this function owns its exact formatting and the agreement check (the
// manifest spec and the Vite plugin) can compare text.
export const renderWhatsNewManifestSource = (
  manifest: readonly WhatsNewManifestEntry[],
): string =>
  [
    "// GENERATED from docs/whats-new/*.md by apps/web/src/whats-new/manifest.ts. Do not edit.",
    `// Regenerate with: ${WHATS_NEW_MANIFEST_COMMAND}`,
    'import type { WhatsNewManifestEntry } from "./types";',
    "",
    `export const WHATS_NEW_MANIFEST: readonly WhatsNewManifestEntry[] = ${JSON.stringify(manifest, null, 2)};`,
    "",
  ].join("\n");
