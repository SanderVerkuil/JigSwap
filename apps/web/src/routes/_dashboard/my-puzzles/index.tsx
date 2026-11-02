import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import {
  usePageHeader,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { RecallLoanButton } from "@/components/exchange/recall-loan-button";
import { CopyOwnerLine } from "@/components/household/copy-owner-line";
import { AddToCollectionDialog } from "@/components/library/add-to-collection-dialog";
import { BulkActionBar } from "@/components/library/bulk-action-bar";
import {
  canSelectCopy,
  planCircleShare,
  selectedInView,
  toggleSelection,
} from "@/components/library/bulk-selection";
import { BulkShareDialog } from "@/components/library/bulk-share-dialog";
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
  viewNeedsWholeLibrary,
  type MyPuzzlesOwner,
  type MyPuzzlesSearch,
  type MyPuzzlesSort,
  type MyPuzzlesStatus,
} from "@/components/library/my-puzzles-filters";
import { MyPuzzlesPhoneFilters } from "@/components/library/my-puzzles-phone-filters";
import { useBulkCopyActions } from "@/components/library/use-bulk-copy-actions";
import {
  LIBRARY_ROWS_MAX,
  useLibraryRows,
} from "@/components/library/use-library-rows";
import { PuzzleCardSkeleton } from "@/components/puzzles/puzzle-card-skeleton";
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
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { loadMemberDataOnServer } from "@/lib/ssr-member-data";
import { convexQuery } from "@convex-dev/react-query";
import type { HouseholdCopyPermission, LoanView } from "@jigswap/contracts";
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
import { useMemo, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/")({
  // View, status pill, whose copies, search and sort live in the URL (defaults omitted), so Back
  // from a copy, a reload or a shared link shows the same list.
  validateSearch: validateMyPuzzlesSearch,
  loaderDeps: ({ search }) => ({ search }),
  // Imported on demand so the browser never downloads it (see the dashboard's loader).
  loader: ({ context, deps }) =>
    loadMemberDataOnServer(context, async () => {
      const { prefetchMyPuzzles } =
        await import("@/components/library/prefetch-my-puzzles");
      return (queryClient) => prefetchMyPuzzles(queryClient, deps.search);
    }),
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
// Persists dismissed state in localStorage. Read as an external store: the server can't know, and
// this page renders on the server with the member's puzzles, so server and hydration leave the hint
// out and it appears right after if it was never dismissed.
// ---------------------------------------------------------------------------
const COACHMARK_KEY = "jigswap.coachmark.myPuzzlesActions";

const coachmarkListeners = new Set<() => void>();

function subscribeCoachmark(listener: () => void) {
  coachmarkListeners.add(listener);
  return () => {
    coachmarkListeners.delete(listener);
  };
}

function ActionsCoachmark() {
  const t = useTranslations("puzzles.coachmark");

  const dismissed = useSyncExternalStore(
    subscribeCoachmark,
    () => localStorage.getItem(COACHMARK_KEY) === "1",
    () => true,
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(COACHMARK_KEY, "1");
    coachmarkListeners.forEach((listener) => listener());
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

// On a phone the shell shows the page's actions in a row of their own above the page, once they are
// published: after hydration. Until then this holds that row's height, so a list the server rendered
// doesn't jump down under the member's thumb. (The row is 16px above the page and this page's gap is
// 18px, hence the margin.)
function PhoneActionsRowPlaceholder() {
  const { actions } = usePageHeaderContent();
  if (actions) return null;
  return (
    <div aria-hidden className="-mb-0.5 h-8 md:hidden pointer-coarse:h-11" />
  );
}

function PuzzlesPage() {
  const t = useTranslations("puzzles");
  const locale = useLocale();
  const displayName = useMemberDisplayName();
  const tLending = useTranslations("lending");
  const tCommon = useTranslations("common");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const viewMode = search.view ?? "grid";
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  // Every control writes its value into the URL (a default clears its key). Replace, not push:
  // changing a filter is not a new page, so Back still leaves My Puzzles in one step.
  const setSearch = (patch: Partial<MyPuzzlesSearch>) =>
    void navigate({
      search: (prev) => validateMyPuzzlesSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  const { member } = useCurrentMember();

  const signedIn = Boolean(member?._id);

  // Selection mode (bulk actions). Only copies the viewer may manage can be selected, and an
  // action covers only the selected copies the current filters show, loaded or not.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [circlePickerOpen, setCirclePickerOpen] = useState(false);

  // A lean row per copy, only while a view needs the whole library: a search, a sort or a status
  // pill, or selection mode (Select all covers every copy the filters show, not just the loaded
  // ones). The plain list never reads it.
  const wholeLibrary = viewNeedsWholeLibrary(filters);
  const { data: index } = useQuery(
    convexQuery(
      gateway.library.myLibraryIndex,
      signedIn && (wholeLibrary || selecting) ? {} : "skip",
    ),
  );
  // The viewer's household (null when in none): My puzzles points at its Puzzles tab, where every
  // puzzle in the household can be filtered by owner. Alone in it there is no one else's puzzle to
  // filter or see, so neither the pointer nor the whose filter shows (unless a link set the filter).
  const { data: myHousehold } = useQuery(
    convexQuery(gateway.household.mine, signedIn ? {} : "skip"),
  );
  const householdShared = (myHousehold?.members.length ?? 0) > 1;
  const showOwnerFilter = householdShared || filters.owner !== "all";

  // Open loans where the caller is the lender; the source of truth for "which of my copies are out".
  const { data: lentOut } = useQuery(convexQuery(gateway.lending.lentOut, {}));
  // Lookup of open loans keyed by the copy's ownedPuzzles _id (LoanView.copyDocId), so each card can
  // tell whether it is currently lent out without an extra per-row query.
  const loanByCopyDocId = useMemo(
    () => new Map((lentOut ?? []).map((loan) => [loan.copyDocId, loan])),
    [lentOut],
  );

  // The member's solve log powers the In Progress / Completed pills and the card's Start/Finish.
  const solveStateByCopyId = useSolveStateByCopyId(signedIn);

  // Every copy this view shows, worked out over the index in the member's locale.
  const matches = useMemo(() => {
    if (!index) return undefined;
    const viaHousehold = new Set(
      index.flatMap((row) => (row.viewerAccess ? [row._id] : [])),
    );
    return filterAndSortCopies(index, filters, {
      viaHousehold: (copyId) => viaHousehold.has(copyId),
      solveState: (copyId) => solveStateByCopyId.get(copyId),
      lentOut: (copyId) => loanByCopyDocId.has(copyId),
      locale,
    });
  }, [index, filters, solveStateByCopyId, loanByCopyDocId, locale]);

  const matchedIds = useMemo(() => matches?.map((copy) => copy._id), [matches]);

  const list = useLibraryRows({
    enabled: signedIn,
    viewKey: JSON.stringify([
      filters.q,
      filters.status,
      filters.owner,
      filters.sort,
    ]),
    windowArgs: { owner: filters.owner },
    ids: wholeLibrary ? matchedIds : null,
  });
  const loadedCopies = useMemo(
    () => list.entries.flatMap(({ copy }) => (copy ? [copy] : [])),
    [list.entries],
  );
  const matchedCount = wholeLibrary ? matches?.length : list.counts?.matched;
  const totalCount = wholeLibrary ? index?.length : list.counts?.total;
  // Nothing to filter, select or open a ⋯ menu on: an empty library shows its empty state alone.
  const libraryEmpty = totalCount === 0 && list.entries.length === 0;

  // What the viewer may do with a housemate's copy; their own copies are absent.
  const householdAccessById = useMemo(() => {
    const access = new Map<string, { viewerAccess: HouseholdCopyPermission }>();
    for (const row of index ?? []) {
      if (row.viewerAccess) {
        access.set(row._id, { viewerAccess: row.viewerAccess });
      }
    }
    for (const copy of loadedCopies) {
      if (copy.household) access.set(copy._id, copy.household);
    }
    return access;
  }, [index, loadedCopies]);

  // The card ⋯ actions (and their dialogs), following the viewer's access to each copy.
  const { cardActions, dialogs } = useCopyCardActions({
    copies: loadedCopies,
    householdAccessById,
    solveStateByCopyId,
  });

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

  // Every puzzle in the household lives on the household's Puzzles tab.
  const householdLink = myHousehold && householdShared && (
    <Link
      href="/household"
      className="text-muted-foreground hover:text-foreground inline-flex max-w-full min-w-0 items-center gap-1.5 self-start text-sm underline-offset-4 hover:underline pointer-coarse:min-h-11"
    >
      <House className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {myHousehold.name
          ? t("householdPointerNamed", { name: myHousehold.name })
          : t("householdPointer")}
      </span>
      <ArrowRight className="size-3.5 shrink-0" aria-hidden />
    </Link>
  );

  const isSelectable = (copy: { _id: string; aggregateId?: string }) =>
    canSelectCopy(copy, householdAccessById.get(copy._id));
  // Everything the filters show once the index is in; until then what's loaded.
  const selectionPool = matches ?? loadedCopies;
  const selectableIds = selectionPool
    .filter(isSelectable)
    .map((copy) => copy._id);
  const selectedIds = new Set(selectedInView(selected, selectableIds));
  const selectedCopies = selectionPool.filter((copy) =>
    selectedIds.has(copy._id),
  );
  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelected(new Set());
  };
  const isHousemateCopy = (copyDocId: string) =>
    householdAccessById.has(copyDocId);
  const bulk = useBulkCopyActions({ isHousemateCopy });
  const circleSharePlan = planCircleShare(selectedCopies, isHousemateCopy);

  // The page title lives in the shell page head; publish the actions there so the
  // page body carries no duplicate header. The count lives beside the filters. Secondary
  // destinations (My suggestions) sit in a ⋯ menu so Add Puzzle is the one header button. On an
  // empty library the empty state's own Add is the one Add on the page.
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
          {!libraryEmpty && (
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
          )}
        </>
      ),
    }),
    [t, libraryEmpty],
  );

  if (!member) {
    return <PuzzlesGridSkeleton />;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <PhoneActionsRowPlaceholder />

      {!libraryEmpty && (
        <>
          {/* One-time coachmark: points users at the ⋯ overflow menu on each card */}
          <ActionsCoachmark />

          {/* Beside the filters from sm; a phone only finds it in the Filters sheet. */}
          {householdLink && (
            <div className="max-sm:hidden">{householdLink}</div>
          )}

          {/* Toolbar: search on the left; whose and sort on the right. On a phone, where these and
            the pills would fill the first screen, the search shares its row with one Filters button
            and the rest moves into its sheet. The Add Puzzle action lives in the shell page head. */}
          <div className="flex flex-wrap items-center gap-2">
            <LibrarySearchInput
              value={filters.q}
              onCommit={(q) => setSearch({ q: q || undefined })}
              label={t("librarySearch.label")}
              placeholder={t("librarySearch.placeholder")}
              maxLength={MAX_SEARCH_LENGTH}
              className="min-w-0 flex-1 basis-56 xl:max-w-sm"
            />
            <MyPuzzlesPhoneFilters
              statusOptions={filterOptions}
              filters={filters}
              showOwner={showOwnerFilter}
              matchedCount={matchedCount}
              householdLink={householdLink}
              onStatusChange={(status) =>
                setSearch({ status: status === "all" ? undefined : status })
              }
              onOwnerChange={(owner) =>
                setSearch({ owner: owner === "all" ? undefined : owner })
              }
              onSortChange={(sort) =>
                setSearch({ sort: sort === "recent" ? undefined : sort })
              }
            />
            <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:hidden">
              {(householdShared || filters.owner !== "all") && (
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
                    <SelectItem value="mine">
                      {t("ownerFilter.mine")}
                    </SelectItem>
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
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDown aria-hidden />
                    {/* Spelled out: Radix only knows the chosen label once hydrated. */}
                    <SelectValue>{t(`sort.${filters.sort}`)}</SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{t("sort.recent")}</SelectItem>
                  <SelectItem value="title">{t("sort.title")}</SelectItem>
                  <SelectItem value="pieces">{t("sort.pieces")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status pills + result count */}
          <FilterBar
            options={filterOptions}
            value={filters.status}
            onChange={(status) =>
              setSearch({ status: status === "all" ? undefined : status })
            }
            pillsClassName="max-sm:hidden"
            countClassName="max-sm:w-full"
            count={
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  {matchedCount !== undefined &&
                    totalCount !== undefined &&
                    t("resultCount", {
                      count: matchedCount,
                      total: totalCount,
                    })}
                </span>
                <span className="flex shrink-0 items-center gap-1 sm:gap-3">
                  <span className="flex items-center gap-1">
                    <Button
                      variant={viewMode === "grid" ? "secondary" : "ghost"}
                      size="icon"
                      aria-label={t("gridView")}
                      aria-pressed={viewMode === "grid"}
                      onClick={() => setSearch({ view: undefined })}
                      className="text-foreground pointer-coarse:size-11"
                    >
                      <Grid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === "list" ? "secondary" : "ghost"}
                      size="icon"
                      aria-label={t("listView")}
                      aria-pressed={viewMode === "list"}
                      onClick={() => setSearch({ view: "list" })}
                      className="text-foreground pointer-coarse:size-11"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </span>
                  {/* Selection mode for bulk actions, offered once there is a copy the viewer manages. */}
                  {selectionPool.some(isSelectable) && (
                    <Button
                      type="button"
                      variant={selecting ? "secondary" : "outline"}
                      size="sm"
                      onClick={toggleSelecting}
                      className="text-foreground pointer-coarse:min-h-11"
                    >
                      {selecting ? (
                        <Check aria-hidden />
                      ) : (
                        <ListChecks aria-hidden />
                      )}
                      {selecting ? t("bulk.done") : t("bulk.select")}
                    </Button>
                  )}
                </span>
              </span>
            }
          />
        </>
      )}

      {/* Puzzles Grid/List */}
      {list.loading ? (
        <PuzzleViewProvider viewMode={viewMode}>
          {Array.from({ length: 8 }, (_, i) => (
            <PuzzleCardSkeleton key={i} />
          ))}
        </PuzzleViewProvider>
      ) : libraryEmpty ? (
        <EmptyState
          title={t("noPuzzles")}
          sub={t("addFirstPuzzle")}
          action={
            <Button variant="brand" asChild>
              <Link href="/my-puzzles/add" data-tour="my-puzzles-add">
                <Plus className="h-4 w-4" />
                {t("addPuzzle")}
              </Link>
            </Button>
          }
        />
      ) : list.entries.length === 0 && !list.stale ? (
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
        // While the next rows or another view load, what's on screen stays, dimmed and marked busy.
        <div
          aria-busy={list.stale}
          className={
            list.stale ? "opacity-60 motion-safe:transition-opacity" : undefined
          }
        >
          <PuzzleViewProvider viewMode={viewMode}>
            {list.entries.map(({ id, copy: puzzle }) => {
              if (!puzzle) return <PuzzleCardSkeleton key={id} />;
              const loan = loanByCopyDocId.get(puzzle._id);
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
                      ? (selectedId) =>
                          setSelected((prev) =>
                            toggleSelection(prev, selectedId),
                          )
                      : undefined
                  }
                  className={
                    selecting && !selectable ? "opacity-60" : undefined
                  }
                  viewBasePath="/my-puzzles"
                  imageFit="contain"
                  {...cardActions(puzzle._id)}
                  owner={
                    puzzle.household && (
                      <CopyOwnerLine
                        owner={puzzle.household.owner}
                        viewOnly={puzzle.household.viewerAccess === "view"}
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
        </div>
      )}

      {/* aria-disabled, not disabled, while the next rows load: a disabled button drops focus. */}
      {list.hasMore && (
        <Button
          variant="outline"
          className="h-11 self-center md:h-9"
          aria-disabled={list.stale}
          onClick={() => {
            if (!list.stale) list.loadMore();
          }}
        >
          {list.stale ? tCommon("loading") : t("showMore")}
        </Button>
      )}
      {list.atMax && (
        <p className="text-muted-foreground text-center text-sm">
          {t("rowsAtMax", { max: LIBRARY_ROWS_MAX })}
        </p>
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
          onShareWithCircle={() => setCirclePickerOpen(true)}
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
      <BulkShareDialog
        open={circlePickerOpen}
        onOpenChange={setCirclePickerOpen}
        count={circleSharePlan.copyIds.length}
        housemates={circleSharePlan.housemates}
        hidden={circleSharePlan.hidden.length}
        onPick={(circle) => bulk.shareWithCircle(circle, selectedCopies)}
      />

      {dialogs}
    </div>
  );
}
