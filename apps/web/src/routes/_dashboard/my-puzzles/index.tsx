import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { EmptyState } from "@/components/library/empty-state";
import { FilterBar, FilterOption } from "@/components/library/filter-bar";
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Grid, List, Plus, Search, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "myPuzzles") }],
  }),
  pendingComponent: () => <PageLoading message="Loading puzzles..." />,
  component: PuzzlesPage,
});

// Status pills mapped onto what the data actually carries: the availability
// flags on each owned copy, and the member's solve log for progress states.
type StatusFilter =
  | "all"
  | "available"
  | "forTrade"
  | "forLend"
  | "inProgress"
  | "completed";

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

function PuzzlesPage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const tLending = useTranslations("lending");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // The loan currently being recalled, so we disable only that copy's Recall button.
  const [recallingId, setRecallingId] = useState<string | null>(null);
  // The copy a solve is being logged against; null when the dialog is closed.
  const [solveTarget, setSolveTarget] = useState<{
    copyId: string;
    title: string;
  } | null>(null);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const userownedPuzzles = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );

  const deletePuzzle = useMutation(gateway.library.deleteOwned);

  // Open loans where the caller is the lender; the source of truth for "which of my copies are out".
  const lentOut = useQuery(gateway.lending.lentOut);
  const recallLoan = useMutation(gateway.lending.recallLoan);

  // The member's solve log powers the In Progress / Completed pills; keyed by
  // the copy's ownedPuzzles _id so each card resolves its state in O(1).
  const completions = useQuery(
    gateway.solving.myCompletions,
    convexUser?._id ? {} : "skip",
  );
  const solveStateByCopyId = useMemo(() => {
    const map = new Map<string, { inProgress: boolean; completed: boolean }>();
    for (const completion of completions ?? []) {
      if (!completion.ownedPuzzleId) continue;
      const state = map.get(completion.ownedPuzzleId) ?? {
        inProgress: false,
        completed: false,
      };
      if (completion.isCompleted) state.completed = true;
      else state.inProgress = true;
      map.set(completion.ownedPuzzleId, state);
    }
    return map;
  }, [completions]);

  // Lookup of open loans keyed by the copy's ownedPuzzles _id (LoanView.copyDocId), so each card can
  // tell whether it is currently lent out without an extra per-row query.
  const loanByCopyDocId = useMemo(
    () => new Map((lentOut ?? []).map((loan) => [loan.copyDocId, loan])),
    [lentOut],
  );

  const handleRecallLoan = async (loanId: string) => {
    setRecallingId(loanId);
    try {
      await recallLoan({ loanId });
    } catch (error) {
      console.error("Failed to recall loan:", error);
    } finally {
      setRecallingId(null);
    }
  };

  const handleDeletePuzzle = async (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain delete takes the Copy aggregateId; resolve it from the loaded row. Guard rows
    // that predate the backfill (no aggregateId) rather than send an unresolvable id.
    const copy = userownedPuzzles?.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot delete: copy is missing its aggregateId.");
      return;
    }
    if (confirm("Are you sure you want to delete this puzzle?")) {
      try {
        await deletePuzzle({
          copyId: copy.aggregateId,
        });
      } catch (error) {
        console.error("Failed to delete puzzle:", error);
      }
    }
  };

  const handleEditPuzzle = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    router.push(`/my-puzzles/${ownedPuzzleId}/edit`);
  };

  const handleViewPuzzle = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    router.push(`/my-puzzles/${ownedPuzzleId}`);
  };

  const handleLogSolve = (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // Solves are logged against the Copy aggregateId; guard rows predating the backfill rather
    // than open a dialog that can't persist.
    const copy = userownedPuzzles?.find((p) => p._id === ownedPuzzleId);
    if (!copy?.aggregateId) {
      console.error("Cannot log a solve: copy is missing its aggregateId.");
      return;
    }
    setSolveTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
    });
  };

  const filterOptions: FilterOption<StatusFilter>[] = [
    { value: "all", label: t("filters.all") },
    { value: "available", label: t("filters.available") },
    { value: "forTrade", label: t("filters.forTrade") },
    { value: "forLend", label: t("filters.forLend") },
    { value: "inProgress", label: t("filters.inProgress") },
    { value: "completed", label: t("filters.completed") },
  ];

  // Search narrows by title/brand; the status pill then maps onto the copy's
  // availability flags or its solve state.
  const filteredownedPuzzles = (userownedPuzzles ?? []).filter((puzzle) => {
    const term = searchTerm.trim().toLowerCase();
    if (
      term &&
      !(
        puzzle.puzzle?.title.toLowerCase().includes(term) ||
        (puzzle.puzzle?.brand &&
          puzzle.puzzle.brand.toLowerCase().includes(term))
      )
    ) {
      return false;
    }
    if (statusFilter === "all") return true;
    const { forTrade, forLend, forSale } = puzzle.availability;
    if (statusFilter === "available") return forTrade || forLend || forSale;
    if (statusFilter === "forTrade") return forTrade;
    if (statusFilter === "forLend") return forLend;
    const solveState = solveStateByCopyId.get(puzzle._id);
    if (statusFilter === "inProgress") return solveState?.inProgress ?? false;
    return solveState?.completed ?? false;
  });

  if (!user || !convexUser || userownedPuzzles === undefined) {
    return <PuzzlesGridSkeleton />;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Toolbar: search on the left, view toggle + Add Puzzle on the right */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1 md:max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder={tCommon("search")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="focus:ring-primary h-10 w-full rounded-md border bg-transparent pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Grid view"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label="List view"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button variant="brand" asChild>
            <Link href="/my-puzzles/add">
              <Plus className="h-4 w-4" />
              {t("addPuzzle")}
            </Link>
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
          total: userownedPuzzles.length,
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
            return (
              <PuzzleCard
                key={puzzle._id}
                puzzle={puzzle}
                variant="default"
                showCollectionDropdown={true}
                onEdit={handleEditPuzzle}
                onView={handleViewPuzzle}
                onDelete={handleDeletePuzzle}
                onLogSolve={handleLogSolve}
                loanBadge={
                  loan && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {tLending("onLoanTo", {
                          name:
                            loan.borrower?.name ?? tLending("unknownMember"),
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

      {solveTarget && (
        <LogSolveDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setSolveTarget(null);
          }}
          copyId={solveTarget.copyId}
          puzzleTitle={solveTarget.title}
        />
      )}
    </div>
  );
}
