"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { FilterBar, type FilterOption } from "./filter-bar";
import type {
  MyPuzzlesFilters,
  MyPuzzlesOwner,
  MyPuzzlesSort,
  MyPuzzlesStatus,
} from "./my-puzzles-filters";

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

// My Puzzles' filters on a phone, where the pills and selects would fill the first screen: one
// Filters button beside the search opens a sheet holding them, and what is on shows as chips that
// can be removed in one tap. Hidden from sm up (CSS, so the server render has the right layout); the
// page shows the controls themselves there. Each choice applies at once: the list behind the sheet
// and the button's count follow.
export function MyPuzzlesPhoneFilters({
  statusOptions,
  filters,
  showOwner,
  matchedCount,
  householdLink,
  onStatusChange,
  onOwnerChange,
  onSortChange,
}: {
  statusOptions: FilterOption<MyPuzzlesStatus>[];
  filters: MyPuzzlesFilters;
  showOwner: boolean;
  /** How many copies the filters leave; undefined while that is being worked out. */
  matchedCount: number | undefined;
  /** The way to the household's own puzzle list, on phones only offered in here. */
  householdLink?: ReactNode;
  onStatusChange: (status: MyPuzzlesStatus) => void;
  onOwnerChange: (owner: MyPuzzlesOwner) => void;
  onSortChange: (sort: MyPuzzlesSort) => void;
}) {
  const t = useTranslations("puzzles");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chips = [
    filters.status !== "all" && {
      key: "status",
      label: statusOptions.find((option) => option.value === filters.status)
        ?.label,
      remove: () => onStatusChange("all"),
    },
    filters.owner !== "all" && {
      key: "owner",
      label: t(`ownerFilter.${filters.owner}`),
      remove: () => onOwnerChange("all"),
    },
  ].filter((chip) => chip !== false);

  const ownerOptions: FilterOption<MyPuzzlesOwner>[] = [
    { value: "all", label: t("ownerFilter.all") },
    { value: "mine", label: t("ownerFilter.mine") },
    { value: "household", label: t("ownerFilter.household") },
  ];
  const sortOptions: FilterOption<MyPuzzlesSort>[] = [
    { value: "recent", label: t("sort.recent") },
    { value: "title", label: t("sort.title") },
    { value: "pieces", label: t("sort.pieces") },
  ];

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            className="shrink-0 pointer-coarse:min-h-11 sm:hidden"
          >
            <SlidersHorizontal aria-hidden />
            {t("filterSheet.title")}{" "}
            {chips.length > 0 && (
              <span className="bg-jigsaw-primary inline-flex size-5 items-center justify-center rounded-full text-xs font-semibold text-white">
                {chips.length}
                <span className="sr-only"> {t("filterSheet.active")}</span>
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="bg-card max-h-[calc(100dvh-3rem)] gap-5 overflow-y-auto overscroll-contain rounded-t-[20px] border-t-0 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <SheetTitle className="pr-10">{t("filterSheet.title")}</SheetTitle>
          <FilterGroup title={t("filterSheet.status")}>
            <FilterBar
              options={statusOptions}
              value={filters.status}
              onChange={onStatusChange}
            />
          </FilterGroup>
          {showOwner && (
            <FilterGroup title={t("ownerFilter.label")}>
              <FilterBar
                options={ownerOptions}
                value={filters.owner}
                onChange={onOwnerChange}
              />
            </FilterGroup>
          )}
          <FilterGroup title={t("sort.label")}>
            <FilterBar
              options={sortOptions}
              value={filters.sort}
              onChange={onSortChange}
            />
          </FilterGroup>
          {householdLink}
          <SheetClose asChild>
            <Button type="button" className="min-h-11 w-full">
              {matchedCount === undefined
                ? t("filterSheet.close")
                : t("filterSheet.show", { count: matchedCount })}
            </Button>
          </SheetClose>
        </SheetContent>
      </Sheet>

      {chips.length > 0 && (
        <div className="order-last flex w-full flex-wrap gap-2 sm:hidden">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t("filterSheet.remove", { filter: chip.label ?? "" })}
              onClick={() => {
                chip.remove();
                // This chip is about to go: focus would drop to the page.
                triggerRef.current?.focus();
              }}
              className="rounded-full pointer-coarse:min-h-11"
            >
              {chip.label}
              <X aria-hidden />
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
