// What an empty exchange list says, per tab, with a next step: All and Outgoing point to Browse
// (that's where a request starts), Incoming to My Puzzles (members can only ask for puzzles the
// viewer offers). When a status filter hides everything, it names the status and offers to clear
// the filter instead.
import { Link } from "@/compat/link";
import { EmptyState } from "@/components/community/primitives";
import { Button } from "@/components/ui/button";
import type { ExchangeStatus, TradesTab } from "@/lib/trades-search";
import { Library, Search } from "lucide-react";
import { useTranslations } from "use-intl";

export function ExchangesEmptyState({
  tab,
  status,
  onShowAllStatuses,
}: {
  tab: Exclude<TradesTab, "loans">;
  status?: ExchangeStatus;
  onShowAllStatuses: () => void;
}) {
  const t = useTranslations("trades");

  if (status !== undefined) {
    return (
      <EmptyState
        title={t("empty.filtered.title", { status: t(`status.${status}`) })}
        sub={t("empty.filtered.sub")}
        action={
          <Button variant="outline" onClick={onShowAllStatuses}>
            {t("empty.filtered.action")}
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      title={t(`empty.${tab}.title`)}
      sub={t(`empty.${tab}.sub`)}
      action={
        tab === "incoming" ? (
          <Button asChild variant="brand">
            <Link href="/my-puzzles">
              <Library className="h-4 w-4" />
              {t("empty.incoming.action")}
            </Link>
          </Button>
        ) : (
          <Button asChild variant="brand">
            <Link href="/browse">
              <Search className="h-4 w-4" />
              {t("empty.browse")}
            </Link>
          </Button>
        )
      }
    />
  );
}
