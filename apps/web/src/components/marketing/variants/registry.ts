// Landing-page variant registry.
//
// Four experimental redesigns of the marketing landing page plus the existing
// "original" layout, all switchable at runtime via the floating tweaks panel
// (see ./switcher.tsx). The selected variant is driven by the `?v=` search
// param on the home route so it is SSR-safe and shareable as a preview URL.

export const VARIANT_IDS = [
  "original",
  "playful",
  "editorial",
  "cozy",
  "retro",
] as const;

export type VariantId = (typeof VARIANT_IDS)[number];

// The variant a fresh visit lands on when no `?v=` param is present. Defaults
// to a redesigned variant (not "original") so reviewers see new work first and
// can switch back to "original" to compare.
export const DEFAULT_VARIANT: VariantId = "playful";

export type VariantMeta = {
  id: VariantId;
  label: string;
  /** One-line personality summary shown in the switcher. */
  tagline: string;
};

export const VARIANTS: VariantMeta[] = [
  {
    id: "original",
    label: "Original",
    tagline: "The current production landing — baseline for comparison.",
  },
  {
    id: "playful",
    label: "Playful-Premium",
    tagline:
      "Illustrated puzzle motifs on clean whitespace, one delightful hero moment.",
  },
  {
    id: "editorial",
    label: "Bold / Editorial",
    tagline:
      "Big expressive type, asymmetric magazine layouts, high personality.",
  },
  {
    id: "cozy",
    label: "Cozy / Hygge",
    tagline: "Warm, lifestyle-led, the feeling of a rainy-day puzzle table.",
  },
  {
    id: "retro",
    label: "Retro / Tactile",
    tagline: "Paper texture, nostalgic palette, board-game-box analog warmth.",
  },
];

export function isVariantId(value: unknown): value is VariantId {
  return (
    typeof value === "string" &&
    (VARIANT_IDS as readonly string[]).includes(value)
  );
}

/** Coerce an unknown search-param value into a valid variant id. */
export function coerceVariant(value: unknown): VariantId {
  return isVariantId(value) ? value : DEFAULT_VARIANT;
}
