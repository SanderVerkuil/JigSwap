// Tours that are not started from a What's new entry (e.g. the quick start's "Show me around"
// hand-off, or a guide for an older feature on the What's new page's Guides tab).
// recordTourProgress accepts these ids as well as any id a manifest entry references.
export const STANDALONE_TOUR_IDS = [
  "getting-started",
  "add-puzzle",
  "exchanges",
  "who-sees-what",
] as const;
export type StandaloneTourId = (typeof STANDALONE_TOUR_IDS)[number];
