"use client";

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
import { useMutation } from "convex/react";
import { useTranslations } from "use-intl";
import { useState } from "react";
import { toast } from "sonner";

// Today as a `yyyy-mm-dd` string for the native date inputs (the dialog defaults the start date
// to today so the common "I just finished" case is one fewer field).
function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

// A date input value (`yyyy-mm-dd`) -> epoch ms at local midnight, or undefined when empty so an
// omitted end date keeps the solve in progress.
function dateInputToMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

interface LogSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Library CopyId aggregateId this solve is logged against; the backend resolves it to the
  // stored copy. The title is display-only.
  copyId: string;
  puzzleTitle: string;
}

export function LogSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
}: LogSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const recordCompletion = useMutation(gateway.solving.recordCompletion);

  const [startDate, setStartDate] = useState(todayInputValue);
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStartDate(todayInputValue());
    setEndDate("");
    setHours("");
    setMinutes("");
    setNotes("");
  };

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    const end = dateInputToMs(endDate);

    // Combine hours+minutes into the single minutes value the domain stores; omit when blank.
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    setSubmitting(true);
    try {
      await recordCompletion({
        copyId,
        startDate: start,
        endDate: end,
        completionTimeMinutes: end === undefined ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
      });
      toast.success(end === undefined ? t("savedInProgress") : t("saved"));
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to log solve:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { puzzle: puzzleTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="solve-start">{t("startDate")}</Label>
              <Input
                id="solve-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="solve-end">{t("endDate")}</Label>
              <Input
                id="solve-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("endDateHint")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("timeLabel")}</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={t("hours")}
                  aria-label={t("hours")}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <div className="space-y-1">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="solve-notes">{t("notes")}</Label>
            <Textarea
              id="solve-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !startDate}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
