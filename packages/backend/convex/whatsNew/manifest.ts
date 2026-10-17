import {
  WHATS_NEW_MANIFEST,
  type WhatsNewManifestEntry,
} from "@jigswap/contracts";

// The What's new entries the backend knows about (generated from docs/whats-new, newest first).
// Read through this accessor so tests can supply fixture entries.
export const whatsNewManifest = (): readonly WhatsNewManifestEntry[] =>
  WHATS_NEW_MANIFEST;
