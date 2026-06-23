"use client";

import { useDurationPrompt } from "@/components/solving/duration-prompt-provider";
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
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

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
  // True when the viewer owns this copy: only then do we offer to update its missing-pieces count.
  viewerIsOwner?: boolean;
}

export function LogSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
  viewerIsOwner = false,
}: LogSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const recordCompletion = useMutation(gateway.solving.recordCompletion);
  const updateDetails = useMutation(gateway.library.updateDetails);
  const { trackCompletionDuration } = useUserSettings();
  const { requestPrompt } = useDurationPrompt();

  const [startDate, setStartDate] = useState(todayInputValue);
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [offerUpdateCopy, setOfferUpdateCopy] = useState(false);

  const showDuration = trackCompletionDuration === true;
  const isFinished = endDate !== "";

  const reset = () => {
    setStartDate(todayInputValue());
    setEndDate("");
    setHours("");
    setMinutes("");
    setNotes("");
    setAllPiecesPresent(true);
  };

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    const end = dateInputToMs(endDate);

    // Combine hours+minutes into the single minutes value the domain stores; omit when blank.
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    const wasFirstChoice = trackCompletionDuration === undefined;

    setSubmitting(true);
    try {
      await recordCompletion({
        copyId,
        startDate: start,
        endDate: end,
        completionTimeMinutes:
          end === undefined || !showDuration ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
        allPiecesPresent: end === undefined ? undefined : allPiecesPresent,
      });
      toast.success(end === undefined ? t("savedInProgress") : t("saved"));

      const piecesMissing = end !== undefined && !allPiecesPresent;
      reset();
      onOpenChange(false);

      // After the log dialog closes: ask the first-time duration question (secondary modal), and/or
      // offer to sync the owned copy's missing-pieces count.
      if (wasFirstChoice) requestPrompt();
      if (piecesMissing && viewerIsOwner) setOfferUpdateCopy(true);
    } catch (error) {
      console.error("Failed to log solve:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmUpdateCopy = async () => {
    try {
      await updateDetails({ copyId, missingPiecesCount: 1 });
    } catch (error) {
      console.error("Failed to update copy pieces:", error);
      toast.error(t("saveError"));
    } finally {
      setOfferUpdateCopy(false);
    }
  };

  return (
    <>
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
                <p className="text-muted-foreground text-xs">
                  {t("endDateHint")}
                </p>
              </div>
            </div>

            {showDuration && (
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
            )}

            {isFinished && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="solve-pieces"
                  checked={allPiecesPresent}
                  onCheckedChange={(checked) =>
                    setAllPiecesPresent(checked === true)
                  }
                />
                <Label htmlFor="solve-pieces">{t("allPiecesPresent")}</Label>
              </div>
            )}

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
            <Button onClick={handleSubmit} disabled={submitting || !startDate}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={offerUpdateCopy} onOpenChange={setOfferUpdateCopy}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("updateCopyPiecesTitle")}</DialogTitle>
            <DialogDescription>{t("updateCopyPiecesBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferUpdateCopy(false)}>
              {t("updateCopyPiecesDismiss")}
            </Button>
            <Button onClick={() => void confirmUpdateCopy()}>
              {t("updateCopyPiecesConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
