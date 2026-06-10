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
import { solvingErrorCode } from "./solving-error";

// Epoch ms -> `yyyy-mm-dd` for a date input (empty for undefined).
function msToDateInput(ms?: number): string {
  if (ms === undefined) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function dateInputToMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

interface EditCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
  initialStartDate: number;
  initialEndDate?: number;
  initialTimeMinutes?: number;
  initialNotes?: string;
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
}: EditCompletionDialogProps) {
  const t = useTranslations("solving.logSolve");
  const tCompletions = useTranslations("solving.completions");
  const editCompletion = useMutation(gateway.solving.editCompletion);

  const [startDate, setStartDate] = useState(msToDateInput(initialStartDate));
  const [endDate, setEndDate] = useState(msToDateInput(initialEndDate));
  const [hours, setHours] = useState(
    initialTimeMinutes ? String(Math.floor(initialTimeMinutes / 60)) : "",
  );
  const [minutes, setMinutes] = useState(
    initialTimeMinutes ? String(initialTimeMinutes % 60) : "",
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    const end = dateInputToMs(endDate);
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    setSubmitting(true);
    try {
      await editCompletion({
        completionId,
        startDate: start,
        endDate: end,
        completionTimeMinutes: end === undefined ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
      });
      toast.success(t("saved"));
      onOpenChange(false);
    } catch (error) {
      // The aggregate rejects edits past 24h; tell the user plainly instead of a generic error.
      if (solvingErrorCode(error) === "EditWindowClosed") {
        toast.error(tCompletions("editWindowClosed"));
      } else {
        console.error("Failed to edit completion:", error);
        toast.error(t("saveError"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tCompletions("edit")}</DialogTitle>
          <DialogDescription>{t("endDateHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-start">{t("startDate")}</Label>
              <Input
                id="edit-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-end">{t("endDate")}</Label>
              <Input
                id="edit-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

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

          <div className="space-y-2">
            <Label htmlFor="edit-notes">{t("notes")}</Label>
            <Textarea
              id="edit-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
