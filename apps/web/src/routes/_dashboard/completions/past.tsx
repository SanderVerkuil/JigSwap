import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { PastSolvesForm } from "@/components/solving/past-solves-form";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/completions/past")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "completionPast") }],
  }),
  component: PastSolvesPage,
});

// Marking the puzzles a member finished before they logged here, a batch at a time: after each
// batch the logged rows are gone and the page stays, so a long history is a matter of carrying on.
// The same form is the quick start's step (/welcome?step=solves), but this page isn't part of that
// flow: no stepper, no next step, and no funnel facts for a member who came back to their log.
function PastSolvesPage() {
  const t = useTranslations("solving.completions");
  const tShell = useTranslations("shell");

  usePageHeader(
    () => ({
      title: t("past.title"),
      crumbs: [
        { label: tShell("groups.library.label"), href: "/library" },
        { label: tShell("pages.completions.title"), href: "/completions" },
      ],
      actions: (
        <Button variant="outline" size="sm" asChild>
          <Link href="/completions">{t("past.back")}</Link>
        </Button>
      ),
    }),
    [t, tShell],
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("past.subtitle")}</p>
      <PastSolvesForm
        emptyText={t("past.empty")}
        emptyAction={
          <Button asChild variant="outline" className="pointer-coarse:min-h-11">
            <Link href="/my-puzzles/add">{t("new.addPuzzle")}</Link>
          </Button>
        }
      />
    </div>
  );
}
