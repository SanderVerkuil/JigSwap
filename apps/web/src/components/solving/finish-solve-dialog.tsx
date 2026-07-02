"use client";

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
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
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
  const finishCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.finishCompletion),
  });
  const { trackCompletionDuration } = useUserSettings();

  const [endDate, setEndDate] = useState(todayInputValue);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const submitting = finishCompletion.isPending;

  const showDuration = trackCompletionDuration === true;

  const handleSubmit = async () => {
    const end = new Date(endDate).getTime();
    if (Number.isNaN(end)) return;
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    try {
      await finishCompletion.mutateAsync({
        completionId,
        endDate: end,
        completionTimeMinutes: showDuration ? totalMinutes : undefined,
        allPiecesPresent,
      });
      toast.success(t("finished"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to finish solve:", error);
      toast.error(t("saveError"));
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
          <Button onClick={handleSubmit} disabled={submitting || !endDate}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
