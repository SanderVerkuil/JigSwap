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
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FinishSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
}

// Marks an in-progress completion finished: captures an end date and an optional time, then
// drives goal-progress recompute server-side via finishCompletion.
export function FinishSolveDialog({
  open,
  onOpenChange,
  completionId,
}: FinishSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const finishCompletion = useMutation(gateway.solving.finishCompletion);

  const [endDate, setEndDate] = useState(todayInputValue);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const end = new Date(endDate).getTime();
    if (Number.isNaN(end)) return;
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    setSubmitting(true);
    try {
      await finishCompletion({
        completionId,
        endDate: end,
        completionTimeMinutes: totalMinutes,
      });
      toast.success(t("finished"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to finish solve:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("finished")}</DialogTitle>
          <DialogDescription>{t("endDateHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="finish-end">{t("endDate")}</Label>
            <Input
              id="finish-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
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
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !endDate}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
