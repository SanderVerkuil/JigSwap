// Pure helpers for the moderation console: classifier-score severity bands and
// the KPI row's average-review-time formatting. Kept free of React so they can
// be unit-tested in isolation (see severity.test.ts).

export const SEVERITY_HIGH = 0.9;
export const SEVERITY_MEDIUM = 0.7;

export type SeverityBand = "high" | "medium" | "low";

// A missing classifier score reads as the least alarming band, not an error.
export function severityBand(score: number | null | undefined): SeverityBand {
  if (score == null) return "low";
  if (score >= SEVERITY_HIGH) return "high";
  if (score >= SEVERITY_MEDIUM) return "medium";
  return "low";
}

// "47m", "1h", "1h 35m"; null (no reviewed submissions this week) renders as an em dash.
export function formatAvgReview(mins: number | null): string {
  if (mins === null) return "—";
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
