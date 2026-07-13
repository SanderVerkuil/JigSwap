// Publisher companies (not product lines) for the one-shot brand→publisher migration and for
// seeding publisher autocomplete suggestions (via getAllPublishers). "Brand" values matching one
// of these are really the puzzle's PUBLISHER; lines like "Jan van Haasteren" or "Wasgij" are
// deliberately absent. Extend before re-running the migration — matching is exact
// (case-insensitive), never fuzzy.
export const KNOWN_PUBLISHERS = [
  "Jumbo",
  "Ravensburger",
  "Falcon",
  "Schmidt",
  "Heye",
  "Clementoni",
  "Educa",
  "Trefl",
  "King",
  "Castorland",
  "Eurographics",
  "Gibsons",
] as const;

// The canonical publisher name for a raw brand value, or undefined when the value is not a
// known publisher company.
export const matchKnownPublisher = (brand: string): string | undefined => {
  const needle = brand.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  return KNOWN_PUBLISHERS.find((name) => name.toLowerCase() === needle);
};
