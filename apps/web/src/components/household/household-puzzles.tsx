import { Link } from "@/compat/link";
import { CopyOwnerLine } from "@/components/household/copy-owner-line";
import type { HouseholdData } from "@/components/household/household-page";
import {
  useCopyCardActions,
  useSolveStateByCopyId,
} from "@/components/library/copy-card-actions";
import { EmptyState } from "@/components/library/empty-state";
import { FilterBar, type FilterOption } from "@/components/library/filter-bar";
import {
  LIBRARY_ROWS_MAX,
  useLibraryRows,
} from "@/components/library/use-library-rows";
import { MemberInitial } from "@/components/members/member-initial";
import { PuzzleCardSkeleton } from "@/components/puzzles/puzzle-card-skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import type { HouseholdCopyPermission } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Grid, List, Plus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

export type AvailabilityFilter = "all" | "available" | "forTrade" | "forLend";

// "all", or the memberId of the one owner to show (the viewer's own id for "You").
export type OwnerFilter = "all" | string;

interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

// The household Puzzles filters: by owner (one member, or everyone) and by availability.
export function filterHouseholdPuzzles<
  T extends { ownerId: string; availability: Availability },
>(copies: readonly T[], owner: OwnerFilter, availability: AvailabilityFilter) {
  return copies.filter((copy) => {
    if (owner !== "all" && copy.ownerId !== owner) return false;
    const { forTrade, forLend, forSale } = copy.availability;
    if (availability === "available") return forTrade || forLend || forSale;
    if (availability === "forTrade") return forTrade;
    if (availability === "forLend") return forLend;
    return true;
  });
}

// The household's default tab: every puzzle in the household, the viewer's own and every
// housemate's, each card saying whose it is. Filter by owner (chips with faces) and by
// availability. Each card has the same ⋯ actions as on My Puzzles, limited to what the viewer
// may do with that copy (useCopyCardActions; the server enforces the same rules).
export function HouseholdPuzzles({
  household,
  onInvite,
}: {
  household: HouseholdData;
  // The admin's Invite dialog, offered when the household has only the viewer in it.
  onInvite?: () => void;
}) {
  const t = useTranslations("household.puzzles");
  const tPuzzles = useTranslations("puzzles");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");

  const viewer = household.members.find((member) => member.isYou);
  const mates = household.members.filter((member) => !member.isYou);

  // Filtering by availability needs the whole library (a lean row per copy, library.myLibraryIndex);
  // anything else reads a window of it.
  const wholeLibrary = availability !== "all";
  const { data: index } = useQuery(
    convexQuery(gateway.library.myLibraryIndex, wholeLibrary ? {} : "skip"),
  );
  const matchedIds = useMemo(
    () =>
      index &&
      filterHouseholdPuzzles(index, owner, availability).map(
        (copy) => copy._id,
      ),
    [index, owner, availability],
  );
  const list = useLibraryRows({
    enabled: viewer !== undefined,
    viewKey: JSON.stringify(["household", owner, availability]),
    windowArgs: owner === "all" ? {} : { memberId: owner as Id<"users"> },
    ids: wholeLibrary ? matchedIds : null,
  });
  const copies = useMemo(
    () => list.entries.flatMap(({ copy }) => (copy ? [copy] : [])),
    [list.entries],
  );
  const matchedCount = wholeLibrary ? matchedIds?.length : list.counts?.matched;
  const totalCount = wholeLibrary ? index?.length : list.counts?.total;

  const householdAccessById = useMemo(() => {
    const access = new Map<string, { viewerAccess: HouseholdCopyPermission }>();
    for (const copy of copies) {
      if (copy.household) access.set(copy._id, copy.household);
    }
    return access;
  }, [copies]);
  const solveStateByCopyId = useSolveStateByCopyId(true);
  const { cardActions, dialogs } = useCopyCardActions({
    copies,
    householdAccessById,
    solveStateByCopyId,
  });

  if (list.loading || !viewer) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-[18px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const availabilityOptions: FilterOption<AvailabilityFilter>[] = [
    { value: "all", label: tPuzzles("filters.all") },
    { value: "available", label: tPuzzles("filters.available") },
    { value: "forTrade", label: tPuzzles("filters.forTrade") },
    { value: "forLend", label: tPuzzles("filters.forLend") },
  ];

  const ownerChips = [
    { value: "all", label: t("ownerAll") },
    { value: viewer.memberId, label: t("you"), person: viewer },
    ...mates.map((mate) => ({
      value: mate.memberId,
      label: displayName(mate),
      person: mate,
    })),
  ];

  const addPuzzle = (
    <Button variant="brand" asChild>
      <Link href="/my-puzzles/add">
        <Plus className="h-4 w-4" />
        {tPuzzles("addPuzzle")}
      </Link>
    </Button>
  );

  if (totalCount === 0 && list.entries.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        sub={t("emptySub")}
        action={addPuzzle}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {mates.length === 0 && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          {t("solo")}
          {onInvite && (
            <Button
              variant="link"
              className="h-auto p-0 pointer-coarse:min-h-11"
              onClick={onInvite}
            >
              <UserPlus aria-hidden className="size-4" />
              {t("soloInvite")}
            </Button>
          )}
        </p>
      )}

      {mates.length > 0 && (
        <div
          role="group"
          aria-label={t("ownerFilter")}
          className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {ownerChips.map((chip) => {
            const active = owner === chip.value;
            return (
              <Button
                key={chip.value}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => setOwner(chip.value)}
                className={cn(
                  "shrink-0 rounded-full pointer-coarse:min-h-11",
                  active &&
                    "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
                )}
              >
                {"person" in chip && chip.person && (
                  <Avatar
                    className={cn(
                      "-ml-1.5 size-5",
                      active && "ring-2 ring-white/70",
                    )}
                  >
                    <AvatarImage src={chip.person.avatar} alt="" />
                    <AvatarFallback className="text-foreground text-[10px]">
                      <MemberInitial source={chip.person} />
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="max-w-[10rem] truncate">{chip.label}</span>
              </Button>
            );
          })}
        </div>
      )}

      <FilterBar
        options={availabilityOptions}
        value={availability}
        onChange={setAvailability}
        count={
          <span className="flex items-center gap-2">
            {matchedCount !== undefined &&
              totalCount !== undefined &&
              tPuzzles("resultCount", {
                count: matchedCount,
                total: totalCount,
              })}
            <span className="flex shrink-0 items-center gap-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                aria-label={tPuzzles("gridView")}
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                aria-label={tPuzzles("listView")}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </span>
          </span>
        }
      />

      {list.entries.length === 0 && !list.stale ? (
        <EmptyState
          title={t("noMatches")}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setOwner("all");
                setAvailability("all");
              }}
            >
              {t("clearFilters")}
            </Button>
          }
        />
      ) : (
        // While the next rows or another filter load, what's on screen stays, dimmed and marked busy.
        <div
          aria-busy={list.stale}
          className={cn(
            "mt-3",
            list.stale && "opacity-60 motion-safe:transition-opacity",
          )}
        >
          <PuzzleViewProvider viewMode={viewMode}>
            {list.entries.map(({ id, copy }) =>
              copy ? (
                <PuzzleCard
                  headingLevel={2}
                  key={copy._id}
                  puzzle={copy}
                  variant="default"
                  viewBasePath="/my-puzzles"
                  imageFit="contain"
                  {...cardActions(copy._id)}
                  owner={
                    copy.household ? (
                      <CopyOwnerLine
                        owner={copy.household.owner}
                        viewOnly={copy.household.viewerAccess === "view"}
                      />
                    ) : (
                      <CopyOwnerLine owner={viewer} isYou />
                    )
                  }
                />
              ) : (
                <PuzzleCardSkeleton key={id} />
              ),
            )}
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
          {list.stale ? tCommon("loading") : tPuzzles("showMore")}
        </Button>
      )}
      {list.atMax && (
        <p className="text-muted-foreground text-center text-sm">
          {tPuzzles("rowsAtMax", { max: LIBRARY_ROWS_MAX })}
        </p>
      )}
      {dialogs}
    </div>
  );
}
