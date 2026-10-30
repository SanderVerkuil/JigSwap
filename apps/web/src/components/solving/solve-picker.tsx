"use client";

import { Image } from "@/compat/image";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { chipColor } from "@/components/library/palette";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DATE_ONLY_TIME_ZONE } from "@/lib/date-input";
import {
  filterSolvePickerSections,
  type SolvePickerItem,
  type SolvePickerSection,
  type SolvePickerSectionId,
} from "@/lib/solve-picker";
import {
  ChevronRight,
  Clock,
  Puzzle,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";

const SECTION_ICON: Record<SolvePickerSectionId, LucideIcon> = {
  inProgress: Clock,
  own: Puzzle,
};

// The "Log a completion" picker: a search over every section, then each non-empty section under
// its own heading. Every puzzle is a real button whose name says what picking it does ("log a
// solve" or "finish solve"), so it works with a keyboard and a screen reader. Rows are compact
// (a 48px cover, title, brand and pieces) and carry nothing about the copy's condition or
// availability, which don't matter when logging a solve. Data and what a pick does come from the
// caller (lib/solve-picker.ts builds the sections).
export function SolvePicker({
  sections,
  onPick,
}: {
  sections: readonly SolvePickerSection[];
  // `trigger` is the row's button, so the caller can return focus to it when its dialog closes.
  onPick: (item: SolvePickerItem, trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations("solving.completions.new");
  const tCommon = useTranslations("common");
  const [searchTerm, setSearchTerm] = useState("");

  if (sections.every((section) => section.items.length === 0)) {
    return <EmptyState title={t("noPuzzles")} sub={t("noPuzzlesHint")} />;
  }

  const visible = filterSolvePickerSections(sections, searchTerm).filter(
    (section) => section.items.length > 0,
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="relative w-full max-w-sm">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label={t("searchLabel")}
          placeholder={tCommon("search")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t("noMatches", { term: searchTerm.trim() })} />
      ) : (
        visible.map((section) => (
          <section key={section.id} className="@container/picker">
            <SectionHead
              title={t(`sections.${section.id}`)}
              icon={SECTION_ICON[section.id]}
              className="mb-3"
            />
            <ul className="grid gap-2 @xl/picker:grid-cols-2 @5xl/picker:grid-cols-3">
              {section.items.map((item, index) => (
                <li key={item.key} className="min-w-0">
                  <SolvePickerRow
                    item={item}
                    index={index}
                    onPick={(trigger) => onPick(item, trigger)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function SolvePickerRow({
  item,
  index,
  onPick,
}: {
  item: SolvePickerItem;
  index: number;
  onPick: (trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations("solving.completions");
  const format = useFormatter();
  const title = item.title ?? t("new.untitled");

  const details = [
    item.brand,
    item.pieceCount !== undefined
      ? t("pieces", { pieces: item.pieceCount })
      : undefined,
  ].filter((part): part is string => !!part);
  // Commas a screen reader pauses on between the parts of the name; not shown.
  const pause = <span className="sr-only">, </span>;
  const actionText = (chunks: ReactNode) => (
    <span className="sr-only">{chunks}</span>
  );

  // The accessible name is the row's own text, so it contains everything visible (WCAG 2.5.3):
  // the title, then what picking does (screen readers only), brand, pieces and, for a solve
  // in progress, when it started.
  return (
    <button
      type="button"
      onClick={(event) => onPick(event.currentTarget)}
      className="bg-card hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-16 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px]"
    >
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt=""
          width={48}
          height={48}
          className="bg-muted size-12 shrink-0 rounded-lg border object-contain"
        />
      ) : (
        <CoverChip color={chipColor(index)} icon={Puzzle} size={48} />
      )}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="line-clamp-2 text-sm font-semibold break-words">
          {item.target.kind === "finish"
            ? t.rich("new.finishLabel", { title, action: actionText })
            : t.rich("new.logLabel", { title, action: actionText })}
        </span>
        {details.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {pause}
            {details.join(" · ")}
          </span>
        )}
        {item.target.kind === "finish" && (
          <Badge variant="secondary" className="font-normal">
            {pause}
            <Clock aria-hidden />
            {t("new.inProgressSince", {
              date: format.dateTime(new Date(item.target.startDate), {
                year: "numeric",
                month: "short",
                day: "numeric",
                timeZone: DATE_ONLY_TIME_ZONE,
              }),
            })}
          </Badge>
        )}
      </span>
      <ChevronRight
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
    </button>
  );
}
