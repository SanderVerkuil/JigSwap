// Typed search params for /admin/moderation, so the console's state survives Back, a reload and a
// shared link, and a notification can point at one item:
// - `tab`: the open tab (absent = Submissions);
// - `item`: the selected row of a list+detail queue (a submission's `_id`, a photo's id/key, a
//   review request's attachment id);
// - `report` / `status`: the Reports tab's open report drawer and its status filter (absent = open);
// - `kind` / `actor`: the Activity Log's filters (a moderation-action kind, an acting admin's member
//   _id). Kept as strings here: the log ignores a kind it does not know, and the server normalises
//   the actor id.
// Anything unknown or malformed is dropped, so a stale link falls back to the defaults.
export const MODERATION_TABS = [
  "submissions",
  "flagged",
  "unchecked",
  "appeals",
  "hashMatches",
  "reports",
  "activity",
] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ModerationSearch = {
  tab?: ModerationTab;
  item?: string;
  report?: string;
  status?: ReportStatus;
  kind?: string;
  actor?: string;
};

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

export function validateModerationSearch(
  search: Record<string, unknown>,
): ModerationSearch {
  return {
    tab: oneOf(search.tab, MODERATION_TABS),
    item: nonEmpty(search.item),
    report: nonEmpty(search.report),
    status: oneOf(search.status, REPORT_STATUSES),
    kind: nonEmpty(search.kind),
    actor: nonEmpty(search.actor),
  };
}
