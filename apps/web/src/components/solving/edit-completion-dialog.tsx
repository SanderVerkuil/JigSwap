"use client";

import {
  SolveFieldError,
  SolveTimeFields,
  useSolveFormErrors,
} from "@/components/solving/solve-time-fields";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import {
  dateInputToMs,
  localTodayInput,
  msToDateInput,
} from "@/lib/date-input";
import {
  hasSolveFormErrors,
  solveFormErrorsFromCode,
  solveMinutes,
  validateSolveForm,
} from "@/lib/solve-form";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { MAX_SOLVE_NOTES_LENGTH } from "@jigswap/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { solveSaveErrorKey, solvingErrorCode } from "./solving-error";

interface EditCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
  initialStartDate: number;
  initialEndDate?: number;
  initialTimeMinutes?: number;
  initialNotes?: string;
  // Absent = "day". A year-only or undated solve's dates are sentinels, so the date inputs start
  // empty; entering a date upgrades the solve to "day" server-side.
  datePrecision?: "day" | "year" | "unknown";
  // A solve still in progress has no end date or time to edit: setting an end here would not
  // finish it (Completion.edit never changes isCompleted), so finishing goes through Finish.
  inProgress?: boolean;
}

// Edits a completion's mutable fields. The 24h window is enforced server-side; a closed window
// surfaces as a graceful inline message rather than the generic save error.
export function EditCompletionDialog({
  open,
  onOpenChange,
  completionId,
  initialStartDate,
  initialEndDate,
  initialTimeMinutes,
  initialNotes,
  datePrecision,
  inProgress = false,
}: EditCompletionDialogProps) {
  const dated = (datePrecision ?? "day") === "day";
  const t = useTranslations("solving.logSolve");
  const tCompletions = useTranslations("solving.completions");
  const tCommon = useTranslations("common");
  const editCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.editCompletion),
  });

  const [startDate, setStartDate] = useState(
    dated ? msToDateInput(initialStartDate) : "",
  );
  const [endDate, setEndDate] = useState(
    dated ? msToDateInput(initialEndDate) : "",
  );
  const [hours, setHours] = useState(
    initialTimeMinutes ? String(Math.floor(initialTimeMinutes / 60)) : "",
  );
  const [minutes, setMinutes] = useState(
    initialTimeMinutes ? String(initialTimeMinutes % 60) : "",
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const submitting = editCompletion.isPending;
  const today = localTodayInput();
  const { show, clearDates, clearTime, startError, endError, timeError } =
    useSolveFormErrors({
      start: "edit-start",
      end: "edit-end",
      time: "edit-time-hours",
    });

  const handleSubmit = async () => {
    const errors = validateSolveForm(
      {
        start: startDate,
        end: inProgress ? undefined : endDate,
        hours: inProgress ? undefined : hours,
        minutes: inProgress ? undefined : minutes,
      },
      { today, datesRequired: dated },
    );
    if (hasSolveFormErrors(errors)) {
      show(errors);
      return;
    }
    const start = dateInputToMs(startDate);
    const end = inProgress ? undefined : dateInputToMs(endDate);
    const totalMinutes = solveMinutes(hours, minutes);

    try {
      await editCompletion.mutateAsync({
        completionId,
        startDate: start,
        endDate: end,
        completionTimeMinutes: end === undefined ? undefined : totalMinutes,
        // Sent even when empty: that is how a note is cleared.
        notes: notes.trim(),
      });
      toast.success(tCompletions("updated"));
      onOpenChange(false);
    } catch (error) {
      const code = solvingErrorCode(error);
      const fieldErrors = solveFormErrorsFromCode(code);
      // The aggregate rejects edits past 24h; tell the user plainly instead of a generic error.
      if (fieldErrors) {
        show(fieldErrors);
      } else if (code === "EditWindowClosed") {
        toast.error(tCompletions("editWindowClosed"));
      } else {
        console.error("Failed to edit completion:", error);
        toast.error(t(solveSaveErrorKey(error)));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Scrolls on a short screen, so Save stays reachable. */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tCompletions("edit")}</DialogTitle>
          <DialogDescription>
            {inProgress
              ? tCompletions("editInProgressDescription")
              : tCompletions("editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={cn(
              "grid grid-cols-1 gap-4",
              !inProgress && "sm:grid-cols-2",
            )}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-start">{t("startDate")}</Label>
              <Input
                id="edit-start"
                type="date"
                value={startDate}
                // A solve still going may start later; a finished one started by today.
                max={inProgress ? undefined : today}
                aria-invalid={startError ? true : undefined}
                aria-describedby={startError ? "edit-start-error" : undefined}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  clearDates();
                }}
              />
              <SolveFieldError id="edit-start-error" message={startError} />
            </div>
            {!inProgress && (
              <div className="space-y-2">
                <Label htmlFor="edit-end">{t("endDate")}</Label>
                <Input
                  id="edit-end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={today}
                  aria-invalid={endError ? true : undefined}
                  aria-describedby={endError ? "edit-end-error" : undefined}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    clearDates();
                  }}
                />
                <SolveFieldError id="edit-end-error" message={endError} />
              </div>
            )}
          </div>

          {!inProgress && (
            <SolveTimeFields
              idPrefix="edit-time"
              hours={hours}
              minutes={minutes}
              onHoursChange={(value) => {
                setHours(value);
                clearTime();
              }}
              onMinutesChange={(value) => {
                setMinutes(value);
                clearTime();
              }}
              error={timeError}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-notes">{t("notes")}</Label>
            <Textarea
              id="edit-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MAX_SOLVE_NOTES_LENGTH}
            />
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
          <Button onClick={handleSubmit} disabled={submitting}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
