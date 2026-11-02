"use client";

import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { useStepCommitRegistration } from "@/components/quick-start/step-commit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { localTodayInput } from "@/lib/date-input";
import {
  pastSolveCandidates,
  toPastCompletionItem,
  yearOptions,
  type PastCompletionItem,
  type PastSolveChoice,
  type PastSolveWhen,
} from "@/lib/past-solves";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { solveSaveErrorKey } from "./solving-error";

// Rows shown at first and added per "Show more"; also the most one submit may log (the
// recordPastCompletions cap), so a member ticks at most this many at once.
const PAGE = 25;

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
  // The lean library index, less housemates' copies: a row needs only its title.
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
// ticks ("Log 3 and continue").
export function PastSolvesList({
  candidates,
  pending,
  emptyText,
  emptyAction,
  onSubmit,
}: {
  candidates: readonly { copyId: string; title: string }[];
  pending: boolean;
  emptyText?: string;
  emptyAction?: ReactNode;
  onSubmit: (items: PastCompletionItem[]) => Promise<boolean>;
}) {
  const t = useTranslations("quickStart.solves");
  const [shown, setShown] = useState(PAGE);
  const [choices, setChoices] = useState<Map<string, PastSolveChoice>>(
    () => new Map(),
  );
  // The member's local today: the latest day a past solve may be picked for.
  const maxDate = localTodayInput();
  const items = [...choices].map(([copyId, choice]) =>
    toPastCompletionItem(copyId, choice, maxDate),
  );
  const ready = items.every((item) => item !== null);

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
    commit: submit,
  });

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
  const showMore = shown < candidates.length;
  const showSubmit = !inFlow && choices.size > 0;

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
      <ul className="flex flex-col">
        {candidates.slice(0, shown).map(({ copyId, title }, index, list) => {
          const choice = choices.get(copyId);
          return (
            <li
              key={copyId}
              className={index < list.length - 1 ? "border-b" : undefined}
            >
              <PastSolveRow
                id={copyId}
                title={title}
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
      {showMore && (
        <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
          {t("showMore")}
        </Button>
      )}
      <div
        className={cn(
          showSubmit &&
            "bg-background sticky bottom-[var(--mobile-tab-bar-height,3.5rem)] z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t py-3 pb-[30px] md:bottom-0 md:pb-3",
        )}
      >
        {/* A live region from the start, so reaching the cap is announced. */}
        <p role="status" className="text-sm empty:hidden">
          {full ? t("batchFull", { count: PAGE }) : null}
        </p>
        {showSubmit && (
          <Button
            className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 ms-auto text-white"
            onClick={() => void submit()}
            disabled={!ready || pending}
          >
            {t("submit", { count: choices.size })}
          </Button>
        )}
      </div>
    </div>
  );
}

// One copy's row: the "I finished <title>" checkbox and, once ticked, the "When?" choice. Fully
// controlled: `choice` is undefined while unticked. Ticking defaults to "I don't remember".
export function PastSolveRow({
  id,
  title,
  choice,
  disabled,
  years,
  maxDate,
  onChange,
}: {
  id: string;
  title: string;
  choice: PastSolveChoice | undefined;
  disabled?: boolean;
  years: readonly number[];
  maxDate: string;
  onChange: (choice: PastSolveChoice | null) => void;
}) {
  const t = useTranslations("quickStart.solves");
  const checkboxId = `past-solve-${id}`;
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
        <Label htmlFor={checkboxId} className="font-normal">
          {t("finished", { title })}
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
              className="bg-card focus:ring-primary h-9 rounded-md border px-2 text-base focus:ring-2 focus:outline-none md:not-pointer-coarse:text-sm"
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
