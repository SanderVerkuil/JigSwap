import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { RecallLoanButton } from "@/components/exchange/recall-loan-button";
import { CopyOwnerLine } from "@/components/household/copy-owner-line";
import { AddToCollectionDialog } from "@/components/library/add-to-collection-dialog";
import { BulkActionBar } from "@/components/library/bulk-action-bar";
import {
  canSelectCopy,
  selectedInView,
  toggleSelection,
} from "@/components/library/bulk-selection";
import {
  useCopyCardActions,
  useSolveStateByCopyId,
} from "@/components/library/copy-card-actions";
import { EmptyState } from "@/components/library/empty-state";
import { FilterBar, FilterOption } from "@/components/library/filter-bar";
import { LibrarySearchInput } from "@/components/library/library-search-input";
import {
  filterAndSortCopies,
  filtersFromSearch,
  MAX_SEARCH_LENGTH,
  validateMyPuzzlesSearch,
  type MyPuzzlesOwner,
  type MyPuzzlesSearch,
  type MyPuzzlesSort,
  type MyPuzzlesStatus,
} from "@/components/library/my-puzzles-filters";
import { useBulkCopyActions } from "@/components/library/use-bulk-copy-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { convexQuery } from "@convex-dev/react-query";
import type { LoanView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  Grid,
  House,
  Lightbulb,
  List,
  ListChecks,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/")({
  // View, status pill, whose copies, search and sort live in the URL (defaults omitted), so Back
  // from a copy, a reload or a shared link shows the same list.
  validateSearch: validateMyPuzzlesSearch,
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

  // A static hint, not a live region: it is on screen from the first paint, so announcing it would
  // only interrupt. The dismiss is a full-size icon button so it is easy to hit on a phone.
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
      <span className="flex-1 py-1">{t("body")}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("dismiss")}
        onClick={handleDismiss}
        className="-my-1.5 -mr-2 size-9 shrink-0 hover:text-foreground pointer-coarse:-my-2.5 pointer-coarse:-mr-3 pointer-coarse:size-11"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

function PuzzlesPage() {
  const { user } = useUser();
  const t = useTranslations("puzzles");
  const locale = useLocale();
  const displayName = useMemberDisplayName();
  const tLending = useTranslations("lending");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const viewMode = search.view ?? "grid";
  const filters = filtersFromSearch(search);
  // Every control writes its value into the URL (a default clears its key). Replace, not push:
  // changing a filter is not a new page, so Back still leaves My Puzzles in one step.
  const setSearch = (patch: Partial<MyPuzzlesSearch>) =>
    void navigate({
      search: (prev) => validateMyPuzzlesSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
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
  const borrowerName = (loan: LoanView) =>
    loan.borrower ? displayName(loan.borrower) : tLending("deletedMember");

  const filterOptions: FilterOption<MyPuzzlesStatus>[] = [
    { value: "all", label: t("filters.all") },
    { value: "available", label: t("filters.available") },
    { value: "forTrade", label: t("filters.forTrade") },
    { value: "forLend", label: t("filters.forLend") },
    { value: "lentOut", label: t("filters.lentOut") },
    { value: "inProgress", label: t("filters.inProgress") },
    { value: "completed", label: t("filters.completed") },
  ];

  const filteredownedPuzzles = filterAndSortCopies(allCopies, filters, {
    viaHousehold: (copyId) => householdAccessById.has(copyId),
    solveState: (copyId) => solveStateByCopyId.get(copyId),
    lentOut: (copyId) => loanByCopyDocId.has(copyId),
    locale,
  });

  // The filters narrowing the list right now, named as their controls name them, so an empty result
  // says what excluded everything (and Show all can undo it) instead of "add your first puzzle".
  const activeFilterLabels = [
    filters.q || undefined,
    filters.status !== "all"
      ? filterOptions.find((option) => option.value === filters.status)?.label
      : undefined,
    filters.owner !== "all" ? t(`ownerFilter.${filters.owner}`) : undefined,
  ].filter((label): label is string => Boolean(label));
  // Clears what narrows the list (search, status, whose); the view and the sort stay as chosen.
  const showAll = () =>
    setSearch({ q: undefined, status: undefined, owner: undefined });

  // Selection mode (bulk actions). Only copies the viewer may manage can be selected, and an
  // action covers only the selected copies the current filters show.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const isSelectable = (copy: (typeof allCopies)[number]) =>
    canSelectCopy(copy, householdAccessById.get(copy._id));
  const selectableIds = filteredownedPuzzles
    .filter(isSelectable)
    .map((copy) => copy._id);
  const selectedIds = new Set(selectedInView(selected, selectableIds));
  const selectedCopies = filteredownedPuzzles.filter((copy) =>
    selectedIds.has(copy._id),
  );
  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelected(new Set());
  };
  const bulk = useBulkCopyActions({
    isHousemateCopy: (copyDocId) => householdAccessById.has(copyDocId),
  });

  // The page title lives in the shell page head; publish the actions there so the
  // page body carries no duplicate header. The count lives beside the filters. Secondary
  // destinations (My suggestions) sit in a ⋯ menu so Add Puzzle is the one header button.
  usePageHeader(
    () => ({
      actions: (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The guided tour's "find your suggestions" step points here. */}
              <Button
                variant="outline"
                size="icon"
                className="size-8 pointer-coarse:size-11"
                aria-label={t("moreActions")}
                data-tour="my-puzzles-suggestions"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/my-puzzles/suggestions">
                  <Lightbulb className="h-4 w-4" aria-hidden />
                  {t("mySuggestions")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="brand"
            size="sm"
            asChild
            className="pointer-coarse:min-h-11"
          >
            <Link href="/my-puzzles/add" data-tour="my-puzzles-add">
              <Plus className="h-4 w-4" />
              {t("addPuzzle")}
            </Link>
          </Button>
        </>
      ),
    }),
    [t],
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

      {/* Every puzzle in the household lives on the household's Puzzles tab. */}
      {myHousehold && (
        <Link
          href="/household"
          className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 self-start text-sm underline-offset-4 hover:underline pointer-coarse:min-h-11"
        >
          <House className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {myHousehold.name
              ? t("householdPointerNamed", { name: myHousehold.name })
              : t("householdPointer")}
          </span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </Link>
      )}

      {/* Toolbar: search on the left; whose, sort and the view toggle on the right. On a phone the
          search shares its row with the view toggle and the selects drop to a row of their own.
          The Add Puzzle action lives in the shell page head. */}
      <div className="flex flex-wrap items-center gap-2">
        <LibrarySearchInput
          value={filters.q}
          onCommit={(q) => setSearch({ q: q || undefined })}
          label={t("librarySearch.label")}
          placeholder={t("librarySearch.placeholder")}
          maxLength={MAX_SEARCH_LENGTH}
          className="min-w-0 flex-1 basis-56 xl:max-w-sm"
        />
        <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:ml-auto sm:w-auto">
          {myHousehold && (
            <Select
              value={filters.owner}
              onValueChange={(value: MyPuzzlesOwner) =>
                setSearch({ owner: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger
                className="max-sm:flex-1 pointer-coarse:min-h-11"
                aria-label={t("ownerFilter.label")}
              >
                {/* Say what the select filters ("Whose: All"), so it doesn't read as a second "All"
                    beside the status pills. */}
                <SelectValue>
                  {t("ownerFilter.trigger", { owner: filters.owner })}
                </SelectValue>
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
          <Select
            value={filters.sort}
            onValueChange={(value: MyPuzzlesSort) =>
              setSearch({ sort: value === "recent" ? undefined : value })
            }
          >
            <SelectTrigger
              className="max-sm:flex-1 pointer-coarse:min-h-11"
              aria-label={t("sort.label")}
            >
              {/* Icon and value stay together on the left when the trigger stretches on a phone. */}
              <span className="flex min-w-0 items-center gap-2">
                <ArrowUpDown aria-hidden />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t("sort.recent")}</SelectItem>
              <SelectItem value="title">{t("sort.title")}</SelectItem>
              <SelectItem value="pieces">{t("sort.pieces")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("gridView")}
            aria-pressed={viewMode === "grid"}
            onClick={() => setSearch({ view: undefined })}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("listView")}
            aria-pressed={viewMode === "list"}
            onClick={() => setSearch({ view: "list" })}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status pills + result count */}
      <FilterBar
        options={filterOptions}
        value={filters.status}
        onChange={(status) =>
          setSearch({ status: status === "all" ? undefined : status })
        }
        count={
          <span className="flex items-center gap-3">
            {t("resultCount", {
              count: filteredownedPuzzles.length,
              total: allCopies.length,
            })}
            {/* Selection mode for bulk actions, offered once there is a copy the viewer manages. */}
            {allCopies.some(isSelectable) && (
              <Button
                type="button"
                variant={selecting ? "secondary" : "outline"}
                size="sm"
                onClick={toggleSelecting}
                className="text-foreground pointer-coarse:min-h-11"
              >
                {selecting ? <Check aria-hidden /> : <ListChecks aria-hidden />}
                {selecting ? t("bulk.done") : t("bulk.select")}
              </Button>
            )}
          </span>
        }
      />

      {/* Puzzles Grid/List */}
      {allCopies.length === 0 ? (
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
      ) : filteredownedPuzzles.length === 0 ? (
        <EmptyState
          title={t("noMatch.title", {
            filters: activeFilterLabels.join(" · "),
          })}
          sub={t("noMatch.sub")}
          action={
            <Button variant="outline" onClick={showAll}>
              {t("noMatch.showAll")}
            </Button>
          }
        />
      ) : (
        <PuzzleViewProvider viewMode={viewMode}>
          {filteredownedPuzzles.map((puzzle) => {
            const loan = loanByCopyDocId.get(puzzle._id);
            const household = householdAccessById.get(puzzle._id);
            const selectable = isSelectable(puzzle);
            return (
              <PuzzleCard
                headingLevel={2}
                key={puzzle._id}
                puzzle={puzzle}
                // While selecting, a tap selects (no navigation, no ⋯ menu); a copy the viewer
                // can't manage shows a disabled checkbox.
                variant={selecting ? "selection" : "default"}
                isSelected={selecting && selectedIds.has(puzzle._id)}
                onSelect={
                  selecting && selectable
                    ? (id) => setSelected((prev) => toggleSelection(prev, id))
                    : undefined
                }
                className={selecting && !selectable ? "opacity-60" : undefined}
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
                          name: borrowerName(loan),
                        })}
                      </Badge>
                      {/* Recall ends the loan at once, so it asks first and reports either way.
                          Hidden while selecting, where a tap on the card selects it. */}
                      {!selecting && (
                        <RecallLoanButton
                          loanId={loan.loanId}
                          puzzleTitle={loan.puzzleTitle}
                          borrowerName={borrowerName(loan)}
                        />
                      )}
                    </div>
                  )
                }
              />
            );
          })}
        </PuzzleViewProvider>
      )}

      {selecting && (
        <BulkActionBar
          selectedCount={selectedCopies.length}
          selectableCount={selectableIds.length}
          busy={bulk.busy}
          onSelectAll={() =>
            setSelected((prev) => new Set([...prev, ...selectableIds]))
          }
          onClear={() => setSelected(new Set())}
          onExit={toggleSelecting}
          onOffer={(action) => void bulk.offer(action, selectedCopies)}
          onAddToCollection={() => setCollectionPickerOpen(true)}
        />
      )}
      <AddToCollectionDialog
        open={collectionPickerOpen}
        onOpenChange={setCollectionPickerOpen}
        count={selectedCopies.length}
        onPick={(collection) =>
          bulk.addToCollection(collection, selectedCopies)
        }
      />

      {dialogs}
    </div>
  );
}
