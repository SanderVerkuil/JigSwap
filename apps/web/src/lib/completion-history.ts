// How the completion log lays out a member's finished solves: one group per year, newest year
// first, and only the first page of rows (Show more adds HISTORY_PAGE_SIZE at a time).
//
// Within a year, dated solves come newest first, then the solves known only by that year (their
// stored date is a mid-year sentinel, so its position among dated solves means nothing). Undated
// solves form a last group: their sentinel is the day they were logged, not when they were solved.
// Dates are calendar dates stored at UTC midnight (lib/date-input), so years are read in UTC.

// Also the most rows the log joins in one read (keep it well below the backend's
// COMPLETION_ROWS_MAX), so its depth doesn't depend on how much a member's rows hold.
export const HISTORY_PAGE_SIZE = 30;

export type HistoryRow = {
  startDate: number;
  endDate?: number;
  datePrecision?: "day" | "year" | "unknown";
};

export type HistoryGroupKey = number | "unknown";

export type HistoryGroup<T> = {
  /** The year, or "unknown" for undated solves. */
  key: HistoryGroupKey;
  /** Every solve in the group, also those beyond the current page. */
  total: number;
  /** The solves of this group on the current page. */
  rows: T[];
};

// The pages of solves the log has asked the backend to join, given those on screen: solves it hasn't
// asked about yet make new pages. A page already asked for never changes, wherever its solves have
// moved to, so its live query and the rows it holds stay on screen when a solve is logged above them.
// The same array comes back when nothing is new.
export function withJoinPages<Id extends string>(
  pages: readonly Id[][],
  ids: readonly Id[],
): readonly Id[][] {
  const asked = new Set(pages.flat());
  const fresh = ids.filter((id) => !asked.has(id));
  if (fresh.length === 0) return pages;
  const added: Id[][] = [];
  for (let i = 0; i < fresh.length; i += HISTORY_PAGE_SIZE) {
    added.push(fresh.slice(i, i + HISTORY_PAGE_SIZE));
  }
  return [...pages, ...added];
}

const at = (row: HistoryRow) => row.endDate ?? row.startDate;

const groupKey = (row: HistoryRow): HistoryGroupKey =>
  row.datePrecision === "unknown"
    ? "unknown"
    : new Date(at(row)).getUTCFullYear();

// Sort rank of a group: years newest first, undated last (below any year).
const groupRank = (key: HistoryGroupKey) => (key === "unknown" ? -1 : key);

export function groupSolveHistory<T extends HistoryRow>(
  rows: readonly T[],
  limit: number,
): { groups: HistoryGroup<T>[]; shown: number; total: number } {
  const ordered = [...rows].sort((a, b) => {
    const byGroup = groupRank(groupKey(b)) - groupRank(groupKey(a));
    if (byGroup !== 0) return byGroup;
    const yearOnly = Number(a.datePrecision === "year");
    const byPrecision = yearOnly - Number(b.datePrecision === "year");
    if (byPrecision !== 0) return byPrecision;
    return at(b) - at(a);
  });

  const totals = new Map<HistoryGroupKey, number>();
  for (const row of ordered) {
    const key = groupKey(row);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const page = ordered.slice(0, limit);
  const groups: HistoryGroup<T>[] = [];
  for (const row of page) {
    const key = groupKey(row);
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, total: totals.get(key) ?? 0, rows: [row] });
  }
  return { groups, shown: page.length, total: ordered.length };
}
