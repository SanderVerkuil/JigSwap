// How long the owner has had a copy, for the copy page's "In your library" line: whole years and
// months from acquisition to now in words ("1 year 5 months", "Less than a month"), from the
// `copyInstance.duration*` plurals.

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4375;

type TenureTranslator = (
  key: "durationLessThanMonth" | "durationYears" | "durationMonths",
  values?: Record<string, number>,
) => string;

export function formatCopyTenure(
  since: number,
  now: number,
  t: TenureTranslator,
): string {
  const total = Math.floor((now - since) / MONTH_MS);
  if (total < 1) return t("durationLessThanMonth");
  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(t("durationYears", { years }));
  if (months > 0) parts.push(t("durationMonths", { months }));
  return parts.join(" ");
}
