"use client";

import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { LeaveGuard } from "@/components/quick-start/leave-guard";
import { useStepCommitRegistration } from "@/components/quick-start/step-commit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import { gateway } from "@/gateway";
import { localTodayInput } from "@/lib/date-input";
import {
  pastSolveCandidates,
  pastSolveRows,
  toPastCompletionItem,
  yearOptions,
  type PastCompletionItem,
  type PastSolveCandidate,
  type PastSolveChoice,
  type PastSolveWhen,
} from "@/lib/past-solves";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";
import { solveSaveErrorKey } from "./solving-error";

// Rows shown at first and added per "Show more"; also the most one submit may log (the
// recordPastCompletions cap), so a member ticks at most this many at once.
const PAGE = 25;
// A list up to this long is read at a glance; a longer one gets a search. A search stays while it has
// a term, so one that outlives a logged batch can still be cleared.
const NO_SEARCH_UP_TO = 10;

// The bulk "I've solved these" step (spec 2026-10-17 §2.4, step 2): the member's own copies with
// no completion yet, each with an "I finished <title>" checkbox and, once ticked, a "When?" choice
// (I don't remember / Which year / Pick a date). One submit logs every ticked row through
// solving.recordPastCompletions. It deliberately does NOT reuse LogSolveDialog, whose success path
// chains a follow-up and duration prompt per solve, and never asks for a time, photos or reviews.
// It sits on /welcome?step=solves (the flow's Continue logs the ticks) and on /completions/past (its
// own submit does). `emptyText` and `emptyAction` are each page's words for "nothing to log".
export function PastSolvesForm({
  emptyText,
  emptyAction,
  onLogged,
}: {
  emptyText?: string;
  emptyAction?: ReactNode;
  onLogged?: (count: number) => void;
}) {
  const t = useTranslations("quickStart.solves");
  const { member } = useCurrentMember();
  // The lean library index, less housemates' copies: a row needs only its title, brand and pieces.
  const { data: library } = useQuery(
    convexQuery(gateway.library.myLibraryIndex, member ? {} : "skip"),
  );
  const { data: solveStates } = useQuery(
    convexQuery(gateway.solving.mySolveStates, member ? {} : "skip"),
  );
  const record = useMutation({
    mutationFn: useConvexMutation(gateway.solving.recordPastCompletions),
  });

  if (library === undefined || solveStates === undefined) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  // Resolves true when the batch was logged, so the list clears its ticks.
  const submit = async (items: PastCompletionItem[]): Promise<boolean> => {
    try {
      await record.mutateAsync({ items });
      toast.success(t("saved", { count: items.length }));
      onLogged?.(items.length);
      return true;
    } catch (error) {
      console.error("Failed to log past solves:", error);
      toast.error(t(solveSaveErrorKey(error)));
      return false;
    }
  };

  return (
    <PastSolvesList
      candidates={pastSolveCandidates(
        library.filter((copy) => !copy.viewerAccess),
        new Set(solveStates.map((state) => state.copyId)),
      ).map((copy) => ({
        copyId: copy.aggregateId as string,
        title: copy.snapshot?.title ?? copy.puzzle?.title ?? "",
        brand: copy.snapshot?.brand ?? copy.puzzle?.brand,
        pieceCount: copy.snapshot?.pieceCount ?? copy.puzzle?.pieceCount,
      }))}
      pending={record.isPending}
      emptyText={emptyText}
      emptyAction={emptyAction}
      onSubmit={submit}
    />
  );
}

// The rows and the submit button, given the candidate copies (newest first). Holds the ticks and
// each row's "When?" answer; at most PAGE rows are ticked at once (the mutation's cap), which it
// says at the cap. The submit only shows once something is ticked (never "Log 0") and stays in view
// while the list scrolls; inside quick setup it never shows, because the flow's Continue logs the
// ticks ("Log 3 and continue"). Leaving with ticks asks first: here its own guard, inside quick
// setup the flow's (QuickStartFlowStep). A long list gets a search; ticks survive it (pastSolveRows).
export function PastSolvesList({
  candidates,
  pending,
  emptyText,
  emptyAction,
  onSubmit,
}: {
  candidates: readonly PastSolveCandidate[];
  pending: boolean;
  emptyText?: string;
  emptyAction?: ReactNode;
  onSubmit: (items: PastCompletionItem[]) => Promise<boolean>;
}) {
  const t = useTranslations("quickStart.solves");
  const tp = useTranslations("puzzles");
  const [shown, setShown] = useState(PAGE);
  const [term, setTerm] = useState("");
  const [choices, setChoices] = useState<Map<string, PastSolveChoice>>(
    () => new Map(),
  );
  // The member's local today: the latest day a past solve may be picked for.
  const maxDate = localTodayInput();
  const items = [...choices].map(([copyId, choice]) =>
    toPastCompletionItem(copyId, choice, maxDate),
  );
  // Ticked rows that can't be logged yet: Pick a date without a date, or with one after today.
  const waiting = new Set(
    [...choices.keys()].filter((_, index) => items[index] === null),
  );
  const ready = waiting.size === 0;
  const reason = ready ? undefined : t("needsDate", { count: waiting.size });

  // Resolves true when the batch was logged, and clears the ticks.
  const submit = async () => {
    const logged = await onSubmit(items as PastCompletionItem[]);
    if (logged) setChoices(new Map());
    return logged;
  };
  const inFlow = useStepCommitRegistration({
    kind: "solves",
    count: choices.size,
    ready,
    reason,
    commit: submit,
  });
  const showSubmit = !inFlow && choices.size > 0;
  // The install tip docks in the same spot, and would hide the submit on a long list: it steps aside.
  useReportSurfaceBusy("pastSolvesSubmit", showSubmit);

  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {emptyText ?? t("empty")}
        </p>
        {emptyAction}
      </div>
    );
  }

  const years = yearOptions(new Date().getFullYear());
  const full = choices.size >= PAGE;
  const { rows, more, noMatch } = pastSolveRows(candidates, {
    term,
    shown,
    ticked: choices,
    waiting,
  });

  const setChoice = (copyId: string, choice: PastSolveChoice | null) =>
    setChoices((prev) => {
      const next = new Map(prev);
      if (choice) next.set(copyId, choice);
      else next.delete(copyId);
      return next;
    });

  return (
    <div className="space-y-4">
      <p className="font-medium">{t("lead")}</p>
      {(candidates.length > NO_SEARCH_UP_TO || term !== "") && (
        <div className="relative w-full max-w-sm">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label={t("searchLabel")}
            placeholder={tp("librarySearch.placeholder")}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      {/* Tabbing through the rows never leaves focus behind what stays on screen: the shell's top
          chrome, the bar below at its tallest (the cap message wraps), and the phone's tab bar.
          Reserved before anything is ticked too, so ticking the focused row can't hide it behind
          the bar that appears. Inside quick setup the flow's footer is no taller. */}
      <div className="space-y-4 [&_:is(button,input,select)]:scroll-mt-[calc(var(--app-sticky-top,0px)+0.5rem)] [&_:is(button,input,select)]:scroll-mb-[calc(var(--mobile-tab-bar-height,3.5rem)+9rem)] md:[&_:is(button,input,select)]:scroll-mb-28">
        {noMatch && (
          <p className="text-muted-foreground text-sm">
            {t("noMatches", { term: term.trim() })}
          </p>
        )}
        <ul className="flex flex-col empty:hidden">
          {rows.map(({ copyId, title, brand, pieceCount }, index, list) => {
            const choice = choices.get(copyId);
            return (
              <li
                key={copyId}
                className={index < list.length - 1 ? "border-b" : undefined}
              >
                <PastSolveRow
                  id={copyId}
                  title={title}
                  brand={brand}
                  pieceCount={pieceCount}
                  choice={choice}
                  disabled={!choice && full}
                  years={years}
                  maxDate={maxDate}
                  onChange={(next) => setChoice(copyId, next)}
                />
              </li>
            );
          })}
        </ul>
        {more && (
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            {t("showMore")}
          </Button>
        )}
      </div>
      <div
        className={cn(
          showSubmit &&
            "bg-background sticky bottom-[var(--mobile-tab-bar-height,3.5rem)] z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3 pb-[30px] md:bottom-0 md:pb-3",
        )}
      >
        {/* A live region from the start, so reaching the cap, or the reason the submit waits, is
            announced. Inside quick setup the flow's footer says the reason, by its Continue. */}
        <p role="status" className="text-sm empty:hidden">
          {!inFlow && reason
            ? reason
            : full
              ? t("batchFull", { count: PAGE })
              : null}
        </p>
        {showSubmit && (
          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            {/* The row may be far up a long list, out of sight while this button stays grey. */}
            {!ready && (
              <Button
                variant="outline"
                onClick={() => {
                  const first = candidates.find(({ copyId }) =>
                    waiting.has(copyId),
                  );
                  if (first) {
                    document.getElementById(dateIdOf(first.copyId))?.focus();
                  }
                }}
              >
                {t("showWaiting")}
              </Button>
            )}
            <Button
              className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white"
              onClick={() => void submit()}
              disabled={!ready || pending}
            >
              {t("submit", { count: choices.size })}
            </Button>
          </div>
        )}
      </div>
      {!inFlow && (
        <LeaveGuard
          work={
            choices.size > 0 ? { kind: "solves", count: choices.size } : null
          }
        />
      )}
    </div>
  );
}

const checkboxIdOf = (copyId: string) => `past-solve-${copyId}`;
const dateIdOf = (copyId: string) => `${checkboxIdOf(copyId)}-date`;

// One copy's row: the "I finished <title>" checkbox and, once ticked, the "When?" choice. Fully
// controlled: `choice` is undefined while unticked. Ticking defaults to "I don't remember".
export function PastSolveRow({
  id,
  title,
  brand,
  pieceCount,
  choice,
  disabled,
  years,
  maxDate,
  onChange,
}: {
  id: string;
  title: string;
  brand?: string;
  pieceCount?: number;
  choice: PastSolveChoice | undefined;
  disabled?: boolean;
  years: readonly number[];
  maxDate: string;
  onChange: (choice: PastSolveChoice | null) => void;
}) {
  const t = useTranslations("quickStart.solves");
  const tp = useTranslations("puzzles");
  const format = useFormatter();
  const details = [
    brand,
    pieceCount &&
      `${format.number(pieceCount)} ${tp("pieces", { count: pieceCount })}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const checkboxId = checkboxIdOf(id);
  const dateErrorId = `${checkboxId}-date-error`;
  const dateRefused = choice?.when === "day" && choice.date > maxDate;
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        <Checkbox
          id={checkboxId}
          checked={choice !== undefined}
          disabled={disabled}
          className="pointer-coarse:size-6"
          onCheckedChange={(checked) =>
            onChange(
              checked === true
                ? { when: "unknown", year: years[0] ?? 0, date: "" }
                : null,
            )
          }
        />
        {/* In the label, so the line reaches a screen reader too: it's what tells two copies with
            the same title apart. */}
        <Label
          htmlFor={checkboxId}
          className="flex-col items-start gap-1 leading-snug font-normal"
        >
          <span>{t("finished", { title })}</span>
          {details && (
            <span className="text-muted-foreground text-xs">{details}</span>
          )}
        </Label>
      </div>
      {choice && (
        <div className="space-y-2 ps-7">
          <p className="text-muted-foreground text-sm">{t("when")}</p>
          <SegmentedPills<PastSolveWhen>
            ariaLabel={t("when")}
            value={choice.when}
            onChange={(when) => onChange({ ...choice, when })}
            options={[
              { value: "unknown", label: t("dontRemember") },
              { value: "year", label: t("whichYear") },
              { value: "day", label: t("pickDate") },
            ]}
          />
          {choice.when === "year" && (
            <select
              aria-label={t("whichYear")}
              value={choice.year}
              onChange={(e) =>
                onChange({ ...choice, year: Number(e.target.value) })
              }
              className="bg-card focus-visible:ring-ring h-9 rounded-md border px-2 text-base focus-visible:ring-2 focus-visible:outline-none md:not-pointer-coarse:text-sm"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          )}
          {choice.when === "day" && (
            <Input
              id={dateIdOf(id)}
              type="date"
              aria-label={t("pickDate")}
              max={maxDate}
              value={choice.date}
              onChange={(e) => onChange({ ...choice, date: e.target.value })}
              aria-invalid={dateRefused ? true : undefined}
              aria-describedby={dateRefused ? dateErrorId : undefined}
              className="w-auto"
            />
          )}
          {dateRefused && (
            <p id={dateErrorId} className="text-destructive text-xs">
              {t("futureDate")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
