// Exchanges › Loans: the one home for every open loan the viewer is part of, in two sections.
// - Borrowed by you (lending.borrowed): copies the viewer holds. A borrower solves here (Start or
//   Finish a solve, Log a past one; the old /borrowed page's actions) and hands the copy back with
//   Return, behind a confirm.
// - Lent out (lending.lentOut): the viewer's copies (and household copies they may manage) that
//   are out on loan, with Recall behind a confirm.
// Each title links to the copy. Each section loads and empties on its own, and an empty one says
// what belongs there and where to go next.
import { Link } from "@/compat/link";
import { CoverChip } from "@/components/community/primitives";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { StartSolveDialog } from "@/components/solving/start-solve-dialog";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import type { LoanView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Library, Package, Search } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { RecallLoanButton } from "./recall-loan-button";
import { ReturnLoanButton } from "./return-loan-button";

export function LoansTab({
  borrowed,
  lentOut,
}: {
  /** Open loans the viewer holds; undefined while loading. */
  borrowed: LoanView[] | undefined;
  /** Open loans of copies the viewer owns or may manage; undefined while loading. */
  lentOut: LoanView[] | undefined;
}) {
  const t = useTranslations("trades.loans");
  return (
    <div className="flex flex-col gap-8">
      <LoanSection title={t("borrowedTitle")} loans={borrowed}>
        {(loans) =>
          loans.length === 0 ? (
            <BorrowedEmpty />
          ) : (
            <BorrowedRows loans={loans} />
          )
        }
      </LoanSection>
      <LoanSection title={t("lentTitle")} loans={lentOut}>
        {(loans) =>
          loans.length === 0 ? <LentEmpty /> : <LentRows loans={loans} />
        }
      </LoanSection>
    </div>
  );
}

function LoanSection({
  title,
  loans,
  children,
}: {
  title: string;
  loans: LoanView[] | undefined;
  children: (loans: LoanView[]) => ReactNode;
}) {
  const tLending = useTranslations("lending");
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="font-heading flex items-baseline gap-2 text-lg font-bold"
      >
        {title}
        {loans && (
          <span className="text-muted-foreground text-sm font-medium">
            {loans.length}
          </span>
        )}
      </h2>
      {loans === undefined ? (
        <div className="py-3">
          <span role="status" className="sr-only">
            {tLending("loading")}
          </span>
          <div aria-hidden className="bg-muted h-12 animate-pulse rounded-lg" />
        </div>
      ) : (
        children(loans)
      )}
    </section>
  );
}

// One loan as an open divided row: chip, the title (linking to the copy) with its piece count, a
// meta line, and the row's actions. Below lg the actions sit under the text (a row of up to three
// buttons would squeeze the title on a tablet), full width on phones so they wrap at most once.
function LoanRow({
  loan,
  href,
  meta,
  index,
  isLast,
  children,
}: {
  loan: LoanView;
  href: string | undefined;
  meta: string;
  index: number;
  isLast: boolean;
  children: ReactNode;
}) {
  const tLending = useTranslations("lending");
  return (
    <li
      className={cn(
        "flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-3.5",
        !isLast && "border-b",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <CoverChip icon={Package} size={44} gradientIndex={index} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-base font-semibold">
            {href ? (
              <Link href={href} className="hover:underline">
                {loan.puzzleTitle}
              </Link>
            ) : (
              loan.puzzleTitle
            )}
            <span className="text-muted-foreground font-medium">
              {" "}
              · {tLending("pieceCount", { count: loan.pieceCount })}
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">{meta}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-[58px] lg:justify-end lg:pl-0">
        {children}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------ Borrowed by you */

function BorrowedRows({ loans }: { loans: LoanView[] }) {
  const t = useTranslations("lending");
  const tSolve = useTranslations("solving.logSolve");
  const tStart = useTranslations("solving.startSolve");
  const displayName = useMemberDisplayName();
  const relativeTime = useRelativeTime();

  // The viewer's own solve log powers the Start puzzle ↔ Finish solve swap per row.
  const { data: completions } = useQuery(
    convexQuery(gateway.solving.myCompletions, {}),
  );
  // Newest in-progress solve per copy _id; a borrowed loan exposes its copy as loan.copyDocId
  // ("" when the copy row is gone — skip those).
  const inProgressByCopyDocId = useMemo(() => {
    const map = new Map<string, { completionId: string; startDate: number }>();
    for (const completion of completions ?? []) {
      if (
        completion.isCompleted ||
        !completion.ownedPuzzleId ||
        !completion.aggregateId
      )
        continue;
      const existing = map.get(completion.ownedPuzzleId);
      if (!existing || completion.startDate > existing.startDate) {
        map.set(completion.ownedPuzzleId, {
          completionId: completion.aggregateId,
          startDate: completion.startDate,
        });
      }
    }
    return map;
  }, [completions]);

  // The open dialog, if any: start a solve, log a past one, or finish the one in progress.
  const [startFor, setStartFor] = useState<LoanView | null>(null);
  const [logFor, setLogFor] = useState<LoanView | null>(null);
  const [finishTarget, setFinishTarget] = useState<{
    completionId: string;
    startDate: number;
  } | null>(null);

  const lenderName = (loan: LoanView) =>
    loan.lender ? displayName(loan.lender) : t("deletedMember");

  return (
    <>
      <ul className="flex flex-col">
        {loans.map((loan, index) => {
          const inProgress =
            loan.copyDocId !== ""
              ? inProgressByCopyDocId.get(loan.copyDocId)
              : undefined;
          return (
            <LoanRow
              key={loan.loanId}
              loan={loan}
              href={loan.copyDocId ? `/copies/${loan.copyDocId}` : undefined}
              meta={`${t("borrowedFrom", { name: lenderName(loan) })} · ${relativeTime(loan.openedAt)}`}
              index={index}
              isLast={index === loans.length - 1}
            >
              {inProgress ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFinishTarget(inProgress)}
                >
                  {tStart("finishTrigger")}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStartFor(loan)}
                  >
                    {tStart("trigger")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLogFor(loan)}
                  >
                    {tSolve("trigger")}
                  </Button>
                </>
              )}
              <ReturnLoanButton
                loanId={loan.loanId}
                puzzleTitle={loan.puzzleTitle}
                lenderName={lenderName(loan)}
              />
            </LoanRow>
          );
        })}
      </ul>

      {startFor && (
        <StartSolveDialog
          open
          onOpenChange={(open) => !open && setStartFor(null)}
          copyId={startFor.copyId}
          puzzleTitle={startFor.puzzleTitle}
        />
      )}
      {logFor && (
        <LogSolveDialog
          open
          onOpenChange={(open) => !open && setLogFor(null)}
          copyId={logFor.copyId}
          puzzleTitle={logFor.puzzleTitle}
          viewerIsOwner={false}
        />
      )}
      {finishTarget && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setFinishTarget(null)}
          completionId={finishTarget.completionId}
          minEndDate={finishTarget.startDate}
        />
      )}
    </>
  );
}

function BorrowedEmpty() {
  const t = useTranslations("lending");
  return (
    <SectionEmpty
      title={t("noBorrowed")}
      sub={t("noBorrowedDescription")}
      href="/browse"
      icon={<Search className="h-4 w-4" />}
      action={t("browseAction")}
    />
  );
}

/* ----------------------------------------------------------------- Lent out */

function LentRows({ loans }: { loans: LoanView[] }) {
  const t = useTranslations("lending");
  const displayName = useMemberDisplayName();
  const relativeTime = useRelativeTime();
  const borrowerName = (loan: LoanView) =>
    loan.borrower ? displayName(loan.borrower) : t("deletedMember");

  return (
    <ul className="flex flex-col">
      {loans.map((loan, index) => (
        <LoanRow
          key={loan.loanId}
          loan={loan}
          // The owner's frame of the copy; it forwards to /copies/<id> for a household mate's copy.
          href={loan.copyDocId ? `/my-puzzles/${loan.copyDocId}` : undefined}
          meta={`${t("onLoanTo", { name: borrowerName(loan) })} · ${relativeTime(loan.openedAt)}`}
          index={index}
          isLast={index === loans.length - 1}
        >
          <RecallLoanButton
            loanId={loan.loanId}
            puzzleTitle={loan.puzzleTitle}
            borrowerName={borrowerName(loan)}
          />
        </LoanRow>
      ))}
    </ul>
  );
}

function LentEmpty() {
  const t = useTranslations("trades.loans.lentEmpty");
  return (
    <SectionEmpty
      title={t("title")}
      sub={t("sub")}
      href="/my-puzzles"
      icon={<Library className="h-4 w-4" />}
      action={t("action")}
    />
  );
}

// A section's own compact empty state (the page-level 🧩 one would repeat twice on this tab).
function SectionEmpty({
  title,
  sub,
  href,
  icon,
  action,
}: {
  title: string;
  sub: string;
  href: string;
  icon: ReactNode;
  action: string;
}) {
  return (
    <div className="py-3">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-0.5 max-w-prose text-sm">{sub}</p>
      <Button asChild size="sm" variant="outline" className="mt-3">
        <Link href={href}>
          {icon}
          {action}
        </Link>
      </Button>
    </div>
  );
}
