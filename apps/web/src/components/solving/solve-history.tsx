import { Button } from "@/components/ui/button";
import {
  groupSolveHistory,
  HISTORY_PAGE_SIZE,
  HISTORY_ROWS_MAX,
  type HistoryRow,
} from "@/lib/completion-history";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// The completion log's History: the member's finished solves under one heading per year (undated
// solves last, lib/completion-history), as far as `limit`. Show more asks for the next page. Past
// the most the log joins at once it says so instead. The rows themselves come from the page
// (renderRow), which may still be joining one.
export function SolveHistory<T extends HistoryRow>({
  rows,
  limit,
  onShowMore,
  renderRow,
}: {
  rows: readonly T[];
  limit: number;
  onShowMore: () => void;
  renderRow: (row: T, index: number, isLast: boolean) => ReactNode;
}) {
  const t = useTranslations("solving.completions");
  const history = groupSolveHistory(rows, limit);
  if (history.total === 0) return null;
  const remaining = history.total - history.shown;

  return (
    <>
      {/* Always shown, so the year headings below sit under a section heading. */}
      <h2 className="text-muted-foreground mb-2 text-sm font-medium">
        {t("historySection")}
      </h2>
      {history.groups.map((group) => (
        <section key={group.key} className="mb-4">
          <h3 className="flex items-baseline gap-2 border-b pb-1.5 text-sm font-semibold">
            {group.key === "unknown" ? t("dateUnknown") : group.key}
            <span className="text-muted-foreground text-xs font-normal">
              {t("yearCount", { count: group.total })}
            </span>
          </h3>
          <div className="flex flex-col">
            {group.rows.map((row, index) =>
              renderRow(row, index, index === group.rows.length - 1),
            )}
          </div>
        </section>
      ))}
      {remaining > 0 && limit < HISTORY_ROWS_MAX && (
        <Button
          variant="outline"
          className="pointer-coarse:min-h-11"
          onClick={onShowMore}
        >
          {t("showMore", { count: Math.min(HISTORY_PAGE_SIZE, remaining) })}
        </Button>
      )}
      {remaining > 0 && limit >= HISTORY_ROWS_MAX && (
        <p className="text-muted-foreground text-sm">
          {t("historyAtMax", { max: HISTORY_ROWS_MAX })}
        </p>
      )}
    </>
  );
}
