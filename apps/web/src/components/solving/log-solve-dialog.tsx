"use client";

import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { useCompletionFollowUp } from "@/components/solving/completion-follow-up-provider";
import {
  showsSolveTime,
  SolveTimeFields,
} from "@/components/solving/solve-time-fields";
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
import { dateInputToMs, localTodayInput } from "@/lib/date-input";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { solveSaveErrorKey } from "./solving-error";

// Whether the member is logging a finished solve or one they are still working on.
type SolveStatus = "finished" | "inProgress";

interface LogSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Library CopyId aggregateId this solve is logged against; the backend resolves it to the
  // stored copy. The title is display-only.
  copyId: string;
  puzzleTitle: string;
  // True when the viewer owns this copy: only then do we offer to update its missing-pieces count.
  viewerIsOwner?: boolean;
  // Called after a successful save (before the dialog closes). Useful for post-save navigation.
  onSuccess?: () => void;
}

export function LogSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
  viewerIsOwner = false,
  onSuccess,
}: LogSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const tCommon = useTranslations("common");
  const recordCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.recordCompletion),
  });
  const updateDetails = useMutation({
    mutationFn: useConvexMutation(gateway.library.updateDetails),
  });
  const {
    isLoading: settingsLoading,
    trackCompletionDuration,
    setTrackDuration,
  } = useUserSettings();
  const { requestFollowUp } = useCompletionFollowUp();

  // Both dates default to the member's local today, so "I just finished" is one tap. "Still
  // solving" is an explicit choice that hides the end date, never a cleared date input.
  const [status, setStatus] = useState<SolveStatus>("finished");
  const [startDate, setStartDate] = useState(() => localTodayInput());
  const [endDate, setEndDate] = useState(() => localTodayInput());
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const [offerUpdateCopy, setOfferUpdateCopy] = useState(false);
  // Set while the update-copy-pieces offer dialog is open; holds the deferred follow-up call so it
  // fires exactly once when that dialog resolves (confirm or dismiss) — OR, if this whole component
  // unmounts first (e.g. navigation on /completions/new), from the unmount cleanup below.
  const followUpAfterUpdateCopyRef = useRef<(() => void) | null>(null);

  // The time question is part of the dialog (not asked after saving), so a member's first solve
  // can carry its time. It shows unless they turned solve times off.
  const showDuration = showsSolveTime(trackCompletionDuration);
  const isFinished = status === "finished";

  // Unmount safety valve: onOpenChange(false) can synchronously unmount this component (e.g.
  // /completions/new's setSolveTarget(null)), which would leave a pending follow-up dangling on
  // the (now-unmountable) update-copy-pieces dialog forever. requestFollowUp is provider-owned,
  // so firing it during unmount is safe.
  useEffect(
    () => () => {
      const cb = followUpAfterUpdateCopyRef.current;
      followUpAfterUpdateCopyRef.current = null;
      cb?.();
    },
    [],
  );

  const reset = () => {
    setStatus("finished");
    setStartDate(localTodayInput());
    setEndDate(localTodayInput());
    setHours("");
    setMinutes("");
    setNotes("");
    setAllPiecesPresent(true);
  };

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    const end = isFinished ? dateInputToMs(endDate) : undefined;
    if (isFinished && end === undefined) return;

    // Combine hours+minutes into the single minutes value the domain stores; omit when blank.
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    try {
      // { completionId (aggregate id), puzzleId, copyId } — the review targets for the follow-up.
      const result = await recordCompletion.mutateAsync({
        copyId,
        startDate: start,
        endDate: end,
        completionTimeMinutes:
          end === undefined || !showDuration ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
        allPiecesPresent: end === undefined ? undefined : allPiecesPresent,
      });
      toast.success(end === undefined ? t("savedInProgress") : t("saved"));

      const completed = end !== undefined;
      const piecesMissing = completed && !allPiecesPresent;
      reset();
      onSuccess?.();
      onOpenChange(false);

      // Follow-up (rating/review/photos) only ever applies to a completed solve — never to an
      // in-progress save.
      const followUp = () => {
        if (completed) requestFollowUp(result);
      };
      // Sequencing: if we're about to offer the update-copy-pieces dialog, defer the follow-up
      // until THAT dialog resolves (confirm or dismiss) so the two never stack; otherwise fire it
      // right away.
      const offerOrFollowUp = () => {
        if (piecesMissing && viewerIsOwner) {
          followUpAfterUpdateCopyRef.current = followUp; // fire when that dialog closes
          setOfferUpdateCopy(true);
        } else {
          followUp();
        }
      };
      offerOrFollowUp();
    } catch (error) {
      console.error("Failed to log solve:", error);
      toast.error(t(solveSaveErrorKey(error)));
    }
  };

  // Once-guarded: nulls the ref before invoking, same pattern as the unmount cleanup above, so a
  // deferred follow-up fires exactly once regardless of which path (confirm, dismiss, or unmount)
  // resolves the offer dialog first.
  const fireFollowUpAfterUpdateCopy = () => {
    const cb = followUpAfterUpdateCopyRef.current;
    followUpAfterUpdateCopyRef.current = null;
    cb?.();
  };

  const confirmUpdateCopy = async () => {
    try {
      await updateDetails.mutateAsync({ copyId, missingPiecesCount: 1 });
    } catch (error) {
      console.error("Failed to update copy pieces:", error);
      toast.error(t("saveError"));
    } finally {
      setOfferUpdateCopy(false);
      fireFollowUpAfterUpdateCopy();
    }
  };

  // "Don't track times": stores the choice (the fields hide once the setting updates) and says
  // where to turn it back on.
  const optOutOfTimes = async () => {
    try {
      await setTrackDuration(false);
      setHours("");
      setMinutes("");
      toast.success(t("timesOff"));
    } catch (error) {
      console.error("Failed to turn off solve times:", error);
      toast.error(t("timesOffError"));
    }
  };

  const closeOfferUpdateCopy = (o: boolean) => {
    setOfferUpdateCopy(o);
    if (!o) fireFollowUpAfterUpdateCopy();
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
            <SegmentedPills<SolveStatus>
              ariaLabel={t("statusLabel")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "finished", label: t("statusFinished") },
                { value: "inProgress", label: t("statusInProgress") },
              ]}
            />

            <div
              className={cn(
                "grid grid-cols-1 gap-4",
                isFinished && "sm:grid-cols-2",
              )}
            >
              <div className="space-y-2">
                <Label htmlFor="solve-start">{t("startDate")}</Label>
                <Input
                  id="solve-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              {isFinished && (
                <div className="space-y-2">
                  <Label htmlFor="solve-end">{t("endDate")}</Label>
                  <Input
                    id="solve-end"
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              )}
            </div>

            {isFinished && showDuration && (
              <SolveTimeFields
                idPrefix="solve-time"
                hours={hours}
                minutes={minutes}
                onHoursChange={setHours}
                onMinutesChange={setMinutes}
                onOptOut={
                  !settingsLoading && trackCompletionDuration === undefined
                    ? () => void optOutOfTimes()
                    : undefined
                }
              />
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
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={recordCompletion.isPending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                recordCompletion.isPending ||
                !startDate ||
                (isFinished && !endDate)
              }
            >
              {t("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={offerUpdateCopy} onOpenChange={closeOfferUpdateCopy}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("updateCopyPiecesTitle")}</DialogTitle>
            <DialogDescription>{t("updateCopyPiecesBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeOfferUpdateCopy(false)}
            >
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
