import { DEFAULT_COLOR_PRESETS } from "@/components/ui/color-picker";

// Name-derived category color: djb2 over the trimmed, lowercased name mapped
// onto the shared picker presets, so the same name always suggests the same
// color. Returns null for a blank name (no derivation).
export function deriveColorFromName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  let hash = 5381;
  for (let index = 0; index < normalized.length; index++) {
    // djb2: hash * 33 + char, kept in uint32 range.
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) >>> 0;
  }
  return DEFAULT_COLOR_PRESETS[hash % DEFAULT_COLOR_PRESETS.length];
}
