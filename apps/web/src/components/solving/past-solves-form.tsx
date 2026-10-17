"use client";

import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type Id } from "@/gateway";
import {
  pastSolveCandidates,
  toPastCompletionItem,
  yearOptions,
  type PastCompletionItem,
  type PastSolveChoice,
  type PastSolveWhen,
} from "@/lib/past-solves";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Rows shown at first and added per "Show more"; also the most one submit may log (the
// recordPastCompletions cap), so a member ticks at most this many at once.
const PAGE = 25;

// Today as a date input value (local), the latest day a past solve may be picked for.
const todayInputValue = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// The bulk "I've solved these" step (spec 2026-10-17 §2.4, step 2): the member's own copies with
// no completion yet, each with an "I finished <title>" checkbox and, once ticked, a "When?" choice
// (I don't remember / Which year / Pick a date). One submit logs every ticked row through
// solving.recordPastCompletions. It deliberately does NOT reuse LogSolveDialog, whose success path
// chains a follow-up and duration prompt per solve, and never asks for a time, photos or reviews.
// Q7 places it on /welcome?step=solves; `emptyAction` is that page's link to step 1.
export function PastSolvesForm({
  emptyAction,
  onLogged,
}: {
  emptyAction?: ReactNode;
  onLogged?: (count: number) => void;
}) {
  const t = useTranslations("quickStart.solves");
  const { member } = useCurrentMember();
  const { data: copies } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      member
        ? { ownerId: member._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );
  const { data: completions } = useQuery(
    convexQuery(gateway.solving.myCompletions, member ? {} : "skip"),
  );
  const record = useMutation({
    mutationFn: useConvexMutation(gateway.solving.recordPastCompletions),
  });

  if (copies === undefined || completions === undefined) {
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
      toast.error(t("saveError"));
      return false;
    }
  };

  return (
    <PastSolvesList
      candidates={pastSolveCandidates(copies, completions).map((copy) => ({
        copyId: copy.aggregateId as string,
        title: copy.snapshot?.title ?? copy.puzzle?.title ?? "",
      }))}
      pending={record.isPending}
      emptyAction={emptyAction}
      onSubmit={submit}
    />
  );
}

// The rows and the submit button, given the candidate copies (newest first). Holds the ticks and
// each row's "When?" answer; at most PAGE rows are ticked at once (the mutation's cap).
export function PastSolvesList({
  candidates,
  pending,
  emptyAction,
  onSubmit,
}: {
  candidates: readonly { copyId: string; title: string }[];
  pending: boolean;
  emptyAction?: ReactNode;
  onSubmit: (items: PastCompletionItem[]) => Promise<boolean>;
}) {
  const t = useTranslations("quickStart.solves");
  const [shown, setShown] = useState(PAGE);
  const [choices, setChoices] = useState<Map<string, PastSolveChoice>>(
    () => new Map(),
  );

  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
        {emptyAction}
      </div>
    );
  }

  const years = yearOptions(new Date().getFullYear());
  const maxDate = todayInputValue();
  const items = [...choices].map(([copyId, choice]) =>
    toPastCompletionItem(copyId, choice),
  );
  const ready = items.every((item) => item !== null);
  const full = choices.size >= PAGE;

  const setChoice = (copyId: string, choice: PastSolveChoice | null) =>
    setChoices((prev) => {
      const next = new Map(prev);
      if (choice) next.set(copyId, choice);
      else next.delete(copyId);
      return next;
    });

  const submit = async () => {
    if (await onSubmit(items as PastCompletionItem[])) setChoices(new Map());
  };

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        {shown < candidates.length ? (
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            {t("showMore")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white"
          onClick={submit}
          disabled={choices.size === 0 || !ready || pending}
        >
          {t("submit", { count: choices.size })}
        </Button>
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
              className="bg-card focus:ring-primary h-9 rounded-md border px-2 text-sm focus:ring-2 focus:outline-none"
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
              className="w-auto"
            />
          )}
        </div>
      )}
    </div>
  );
}
