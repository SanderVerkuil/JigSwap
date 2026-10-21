import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { CopyOwnerLine } from "@/components/household/copy-owner-line";
import {
  useCopyCardActions,
  useSolveStateByCopyId,
} from "@/components/library/copy-card-actions";
import { EmptyState } from "@/components/library/empty-state";
import { FilterBar, FilterOption } from "@/components/library/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Grid,
  House,
  Lightbulb,
  List,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "myPuzzles") }],
  }),
  pendingComponent: () => <PuzzlesPending />,
  component: PuzzlesPage,
});

function PuzzlesPending() {
  const t = useTranslations("puzzles");
  return <PageLoading message={t("loadingPuzzles")} />;
}

// Status pills mapped onto what the data actually carries: the availability
// flags on each owned copy, and the member's solve log for progress states.
type StatusFilter =
  "all" | "available" | "forTrade" | "forLend" | "inProgress" | "completed";

function PuzzlesGridSkeleton() {
  return (
    <div className="flex flex-col gap-[18px]">
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-[18px]">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-time coachmark banner
// Persists dismissed state in localStorage; lazy-initialised so it never reads
// `window` during render (SSR safe), and avoids a setState-in-effect pattern.
// ---------------------------------------------------------------------------
const COACHMARK_KEY = "jigswap.coachmark.myPuzzlesActions";

function ActionsCoachmark() {
  const t = useTranslations("puzzles.coachmark");

  // Lazy initialiser: reads localStorage once at mount, never in the render body.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(COACHMARK_KEY) === "1";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(COACHMARK_KEY, "1");
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground"
    >
      <span className="flex-1">{t("body")}</span>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function PuzzlesPage() {
  const { user } = useUser();
  const t = useTranslations("puzzles");
  const displayName = useMemberDisplayName();
  const tLending = useTranslations("lending");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Whose copies to show when the viewer is in a household: everything, only their own, or only
  // the ones that come through a household member.
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine" | "household">(
    "all",
  );
  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: userownedPuzzles, isPending: userownedPuzzlesPending } =
    useQuery(
      convexQuery(
        gateway.library.ownedByOwner,
        convexUser?._id
          ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
          : "skip",
      ),
    );

  // Household copies: the other members' copies, shown after the member's own (copies stay owned by
  // whoever added them; `household.viewerAccess` says whether the viewer may manage or only view).
  const { data: householdCopies } = useQuery(
    convexQuery(gateway.household.copies, convexUser?._id ? {} : "skip"),
  );
  // The viewer's household (null when in none): My puzzles points at its Puzzles tab, where every
  // puzzle in the household can be filtered by owner.
  const { data: myHousehold } = useQuery(
    convexQuery(gateway.household.mine, convexUser?._id ? {} : "skip"),
  );
  const allCopies = useMemo(
    () => [...(userownedPuzzles ?? []), ...(householdCopies ?? [])],
    [userownedPuzzles, householdCopies],
  );
  const householdAccessById = useMemo(
    () =>
      new Map(
        (householdCopies ?? []).map((copy) => [copy._id, copy.household]),
      ),
    [householdCopies],
  );

  // Open loans where the caller is the lender; the source of truth for "which of my copies are out".
  const { data: lentOut } = useQuery(convexQuery(gateway.lending.lentOut, {}));
  const recallLoan = useMutation({
    mutationFn: useConvexMutation(gateway.lending.recallLoan),
  });
  // The loan currently being recalled, so we disable only that copy's Recall button.
  const recallingId = recallLoan.isPending
    ? (recallLoan.variables?.loanId ?? null)
    : null;

  // The member's solve log powers the In Progress / Completed pills and the card's Start/Finish.
  const solveStateByCopyId = useSolveStateByCopyId(Boolean(convexUser?._id));
  // The card ⋯ actions (and their dialogs), following the viewer's access to each copy.
  const { cardActions, dialogs } = useCopyCardActions({
    copies: allCopies,
    householdAccessById,
    solveStateByCopyId,
  });

  // Lookup of open loans keyed by the copy's ownedPuzzles _id (LoanView.copyDocId), so each card can
  // tell whether it is currently lent out without an extra per-row query.
  const loanByCopyDocId = useMemo(
    () => new Map((lentOut ?? []).map((loan) => [loan.copyDocId, loan])),
    [lentOut],
  );

  const handleRecallLoan = async (loanId: string) => {
    try {
      await recallLoan.mutateAsync({ loanId });
    } catch (error) {
      console.error("Failed to recall loan:", error);
    }
  };

  const filterOptions: FilterOption<StatusFilter>[] = [
    { value: "all", label: t("filters.all") },
    { value: "available", label: t("filters.available") },
    { value: "forTrade", label: t("filters.forTrade") },
    { value: "forLend", label: t("filters.forLend") },
    { value: "inProgress", label: t("filters.inProgress") },
    { value: "completed", label: t("filters.completed") },
  ];

  // Free-text search now lives in the global ⌘K palette; this page narrows only by status. The
  // status pill maps onto the copy's availability flags or its solve state.
  const filteredownedPuzzles = allCopies.filter((puzzle) => {
    const viaHousehold = householdAccessById.has(puzzle._id);
    if (ownerFilter === "mine" && viaHousehold) return false;
    if (ownerFilter === "household" && !viaHousehold) return false;
    if (statusFilter === "all") return true;
    const { forTrade, forLend, forSale } = puzzle.availability;
    if (statusFilter === "available") return forTrade || forLend || forSale;
    if (statusFilter === "forTrade") return forTrade;
    if (statusFilter === "forLend") return forLend;
    const solveState = solveStateByCopyId.get(puzzle._id);
    if (statusFilter === "inProgress") return solveState?.inProgress ?? false;
    return solveState?.completed ?? false;
  });

  // The page title lives in the shell page head; publish the owned count + the
  // Add Puzzle action there so the page body carries no duplicate header.
  const ownedCount = allCopies.length;
  const headerMeta = t("countMeta", { count: ownedCount });
  usePageHeaderActions(
    () => (
      <>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {headerMeta}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link
            href="/my-puzzles/suggestions"
            data-tour="my-puzzles-suggestions"
          >
            <Lightbulb className="h-4 w-4" />
            {t("mySuggestions")}
          </Link>
        </Button>
        <Button variant="brand" size="sm" asChild>
          <Link href="/my-puzzles/add" data-tour="my-puzzles-add">
            <Plus className="h-4 w-4" />
            {t("addPuzzle")}
          </Link>
        </Button>
      </>
    ),
    [headerMeta],
  );

  if (
    !user ||
    !convexUser ||
    userownedPuzzlesPending ||
    userownedPuzzles === undefined
  ) {
    return <PuzzlesGridSkeleton />;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* One-time coachmark: points users at the ⋯ overflow menu on each card */}
      <ActionsCoachmark />

      {/* Toolbar: a muted search hint on the left, view toggle on the right. Free-text search moved
          to the global ⌘K palette; the count + Add Puzzle action live in the shell page head. */}
      <div className="flex flex-wrap items-center gap-3">
        {myHousehold ? (
          <Link
            href="/household"
            className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 text-sm underline-offset-4 hover:underline pointer-coarse:min-h-11"
          >
            <House className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              {myHousehold.name
                ? t("householdPointerNamed", { name: myHousehold.name })
                : t("householdPointer")}
            </span>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          </Link>
        ) : (
          <p className="text-muted-foreground hidden text-sm sm:block">
            {t("searchHint")}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {myHousehold && (
            <Select
              value={ownerFilter}
              onValueChange={(value: "all" | "mine" | "household") =>
                setOwnerFilter(value)
              }
            >
              <SelectTrigger
                className="w-44 pointer-coarse:min-h-11"
                aria-label={t("ownerFilter.label")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ownerFilter.all")}</SelectItem>
                <SelectItem value="mine">{t("ownerFilter.mine")}</SelectItem>
                <SelectItem value="household">
                  {t("ownerFilter.household")}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("gridView")}
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("listView")}
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status pills + result count */}
      <FilterBar
        options={filterOptions}
        value={statusFilter}
        onChange={setStatusFilter}
        count={t("resultCount", {
          count: filteredownedPuzzles.length,
          total: allCopies.length,
        })}
      />

      {/* Puzzles Grid/List */}
      {filteredownedPuzzles.length === 0 ? (
        <EmptyState
          title={t("noPuzzles")}
          sub={t("addFirstPuzzle")}
          action={
            <Button variant="brand" asChild>
              <Link href="/my-puzzles/add">
                <Plus className="h-4 w-4" />
                {t("addPuzzle")}
              </Link>
            </Button>
          }
        />
      ) : (
        <PuzzleViewProvider viewMode={viewMode}>
          {filteredownedPuzzles.map((puzzle) => {
            const loan = loanByCopyDocId.get(puzzle._id);
            const household = householdAccessById.get(puzzle._id);
            return (
              <PuzzleCard
                key={puzzle._id}
                puzzle={puzzle}
                variant="default"
                viewBasePath="/my-puzzles"
                imageFit="contain"
                {...cardActions(puzzle._id)}
                owner={
                  household && (
                    <CopyOwnerLine
                      owner={household.owner}
                      viewOnly={household.viewerAccess === "view"}
                    />
                  )
                }
                loanBadge={
                  loan && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {tLending("onLoanTo", {
                          name: loan.borrower
                            ? displayName(loan.borrower)
                            : tLending("deletedMember"),
                        })}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        disabled={recallingId === loan.loanId}
                        onClick={() => handleRecallLoan(loan.loanId)}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        {recallingId === loan.loanId
                          ? tLending("recalling")
                          : tLending("recallAction")}
                      </Button>
                    </div>
                  )
                }
              />
            );
          })}
        </PuzzleViewProvider>
      )}

      {dialogs}
    </div>
  );
}
