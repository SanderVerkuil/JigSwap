import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "use-intl";

// Module-level so the ref callback keeps its identity: focus moves to the heading once, when the
// panel replaces the form (whose submit button had focus), not on every re-render.
const focusOnMount = (el: HTMLElement | null) => el?.focus();

/**
 * Shown in place of the contribute form once a puzzle is submitted. A pending submission is not
 * in the catalogue yet, so instead of sending the member there this says what happens next and
 * offers adding a copy of it to their own puzzles (when its id is known).
 */
export function ContributeSuccess({
  title,
  puzzleId,
  onContributeAnother,
}: {
  title: string;
  /** The new definition's Convex id when it is pending review; null when unknown. */
  puzzleId: string | null;
  onContributeAnother: () => void;
}) {
  const t = useTranslations("puzzles.contributeDone");
  return (
    <section className="flex max-w-xl flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <CircleCheck
        aria-hidden
        className="size-8 text-jigsaw-secondary-text"
        strokeWidth={1.75}
      />
      <div className="flex flex-col gap-1.5">
        <h2
          ref={focusOnMount}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {puzzleId
            ? t("pendingTitle", { title })
            : t("submittedTitle", { title })}
        </h2>
        {puzzleId && (
          <p className="text-sm text-muted-foreground">{t("pendingBody")}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {puzzleId && (
          <Button asChild>
            <Link href={`/my-puzzles/add/new?puzzleId=${puzzleId}`}>
              {t("addToMyPuzzles")}
            </Link>
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onContributeAnother}>
          {t("contributeAnother")}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/puzzles">{t("backToCatalogue")}</Link>
        </Button>
      </div>
    </section>
  );
}
