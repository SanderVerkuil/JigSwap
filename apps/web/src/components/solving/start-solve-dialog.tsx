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
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateInputToMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

interface StartSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Library CopyId aggregateId to start a solve on; the backend resolves + authorizes it.
  copyId: string;
  puzzleTitle: string;
  onSuccess?: () => void;
}

// The first-class "Start puzzle" action: date (default today, editable to past/future) + optional
// notes. Recording an already-finished solve stays in LogSolveDialog.
export function StartSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
  onSuccess,
}: StartSolveDialogProps) {
  const t = useTranslations("solving.startSolve");
  const startCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.startCompletion),
  });

  const [startDate, setStartDate] = useState(todayInputValue);
  const [notes, setNotes] = useState("");

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    try {
      await startCompletion.mutateAsync({
        copyId,
        startDate: start,
        notes: notes.trim() || undefined,
      });
      toast.success(t("started"));
      setStartDate(todayInputValue());
      setNotes("");
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to start solve:", error);
      toast.error(t("saveError"));
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
          <div className="space-y-2">
            <Label htmlFor="start-solve-date">{t("startDate")}</Label>
            <Input
              id="start-solve-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="start-solve-notes">{t("notes")}</Label>
            <Textarea
              id="start-solve-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={startCompletion.isPending || !startDate}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
