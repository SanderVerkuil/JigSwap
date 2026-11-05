import { Link } from "@/compat/link";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { Link as RouterLink } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslations } from "use-intl";

// The completion log without any solve: log one now (the picker offers own, borrowed and
// household puzzles), or mark the puzzles solved before joining in the quick start's past-solves
// step. While it shows, its button replaces the page head's Log action, so it carries that
// action's tour anchor.
export function CompletionsEmptyState() {
  const t = useTranslations("solving.completions");
  return (
    <EmptyState
      title={t("empty")}
      sub={t("emptyHint")}
      action={
        <div className="flex flex-col items-center gap-3">
          <Button variant="brand" asChild className="pointer-coarse:min-h-11">
            <Link href="/completions/new" data-tour="completions-log">
              <Plus aria-hidden className="h-4 w-4" />
              {t("emptyLog")}
            </Link>
          </Button>
          <p className="text-muted-foreground text-sm">
            {t.rich("emptyPastSolves", {
              link: (chunks) => (
                <RouterLink
                  to="/welcome"
                  search={{ step: "solves" }}
                  className="text-foreground font-medium underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:py-3"
                >
                  {chunks}
                </RouterLink>
              ),
            })}
          </p>
        </div>
      }
    />
  );
}
