import { DEFAULT_COLOR_PRESETS } from "@/components/ui/color-picker";

// Name-derived category color: djb2 over the trimmed, lowercased name mapped
// onto the shared picker presets, so the same name always suggests the same
// color. Accepts a fallback chain (e.g. [en, nl]) — the first non-blank name
// wins, so a Dutch-only draft still gets a color. Returns null when every
// candidate is blank (no derivation).
export function deriveColorFromName(name: string | string[]): string | null {
  const candidates = Array.isArray(name) ? name : [name];
  const normalized =
    candidates
      .map((candidate) => candidate.trim().toLowerCase())
      .find((candidate) => candidate.length > 0) ?? "";
  if (!normalized) return null;
  let hash = 5381;
  for (let index = 0; index < normalized.length; index++) {
    // djb2: hash * 33 + char, kept in uint32 range.
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) >>> 0;
  }
  return DEFAULT_COLOR_PRESETS[hash % DEFAULT_COLOR_PRESETS.length];
}
