"use client";

import { useCompletionFollowUp } from "@/components/solving/completion-follow-up-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import {
  DATE_ONLY_TIME_ZONE,
  dateInputToMs,
  localTodayInput,
  msToDateInput,
} from "@/lib/date-input";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";
import { solvingErrorCode } from "./solving-error";

interface FinishSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
  /** The solve's startDate (epoch ms); floors the end-date input so a future-dated start can't
   * produce an opaque domain rejection, and is shown as "You started on {date}". Optional — call
   * sites without the row omit it. */
  minEndDate?: number;
  // Names the puzzle in the question ("When did you finish {puzzle}?"); a generic question
  // without it.
  puzzleTitle?: string;
  // Called after a successful finish (before the dialog closes, after the follow-up is
  // requested). Useful for post-save navigation.
  onSuccess?: () => void;
}

// Marks an in-progress completion finished: captures an end date and an optional time, then
// drives goal-progress recompute server-side via finishCompletion.
export function FinishSolveDialog({
  open,
  onOpenChange,
  completionId,
  minEndDate,
  puzzleTitle,
  onSuccess,
}: FinishSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const finishCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.finishCompletion),
  });
  const { trackCompletionDuration } = useUserSettings();
  const { requestFollowUp } = useCompletionFollowUp();

  const [endDate, setEndDate] = useState(() => localTodayInput());
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const submitting = finishCompletion.isPending;

  const showDuration = trackCompletionDuration === true;

  const handleSubmit = async () => {
    const end = dateInputToMs(endDate);
    if (end === undefined) return;
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    try {
      const result = await finishCompletion.mutateAsync({
        completionId,
        endDate: end,
        completionTimeMinutes: showDuration ? totalMinutes : undefined,
        allPiecesPresent,
      });
      toast.success(t("finished"));
      requestFollowUp(result);
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to finish solve:", error);
      toast.error(
        solvingErrorCode(error) === "InvalidTimeRange"
          ? t("endBeforeStartError")
          : t("saveError"),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("finishTitle")}</DialogTitle>
          <DialogDescription>
            {puzzleTitle
              ? t("finishDescription", { puzzle: puzzleTitle })
              : t("finishDescriptionGeneric")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="finish-end">{t("endDate")}</Label>
            <Input
              id="finish-end"
              type="date"
              value={endDate}
              min={
                minEndDate !== undefined ? msToDateInput(minEndDate) : undefined
              }
              aria-describedby={
                minEndDate !== undefined ? "finish-started-on" : undefined
              }
              onChange={(e) => setEndDate(e.target.value)}
            />
            {/* Says why this dialog opened (e.g. from /completions/new) and why earlier dates
                are refused. The start is a calendar date, so it formats in UTC. */}
            {minEndDate !== undefined && (
              <p
                id="finish-started-on"
                className="text-muted-foreground text-xs"
              >
                {t("startedOn", {
                  date: format.dateTime(new Date(minEndDate), {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: DATE_ONLY_TIME_ZONE,
                  }),
                })}
              </p>
            )}
          </div>

          {showDuration && (
            <div className="space-y-2">
              <Label>{t("timeLabel")}</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={t("hours")}
                  aria-label={t("hours")}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <Input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  placeholder={t("minutes")}
                  aria-label={t("minutes")}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="finish-pieces"
              checked={allPiecesPresent}
              onCheckedChange={(checked) =>
                setAllPiecesPresent(checked === true)
              }
            />
            <Label htmlFor="finish-pieces">{t("allPiecesPresent")}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !endDate}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
