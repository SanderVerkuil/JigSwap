import { Link } from "@/compat/link";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { Plus, Target } from "lucide-react";
import { useTranslations } from "use-intl";

// Insights before the member's first finished solve: in place of the zero solve figures and the
// empty solves-per-month chart, say what fills them and offer the two ways to start.
export function InsightsEmptyState() {
  const t = useTranslations("insights");
  return (
    <EmptyState
      title={t("emptyTitle")}
      sub={t("emptyHint")}
      action={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="brand" asChild className="pointer-coarse:min-h-11">
            <Link href="/completions/new">
              <Plus aria-hidden className="h-4 w-4" />
              {t("emptyLog")}
            </Link>
          </Button>
          <Button variant="outline" asChild className="pointer-coarse:min-h-11">
            <Link href="/goals">
              <Target aria-hidden className="h-4 w-4" />
              {t("emptyGoal")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
