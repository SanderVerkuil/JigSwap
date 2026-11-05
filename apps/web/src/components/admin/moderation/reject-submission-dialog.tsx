"use client";

// Reject a pending catalogue submission with a reason the submitter is told. Rejection is final
// (rejected is a terminal status), so the dialog names that effect and asks for a reason: one of
// the presets, plus an optional note (required for "Other", where the note is the whole reason).
// The reason is written in the admin's language, like a proposal-decline reason, and the dialog
// shows the exact text the member will read. When the duplicate check found a match, "Duplicate
// of “{title}”" is preselected. Like Edit & Approve, the route keys each opening by the submission
// it was opened for; if that submission leaves the queue meanwhile (`handledElsewhere`), the
// dialog says so and Reject is disabled.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";

export const REJECT_PRESETS = [
  "duplicate",
  "incomplete",
  "notJigsaw",
  "other",
] as const;
export type RejectPreset = (typeof REJECT_PRESETS)[number];

// Well inside the server's 1000-character cap (catalog/rejectPuzzleDefinition.ts) once the preset
// text is in front of it.
export const MAX_REJECT_NOTE = 500;

// The reason the member reads: the preset text, then the note. "Other" tells the member nothing on
// its own, so there the note is the whole reason (empty until the admin writes one).
export function composeRejectionReason(
  preset: RejectPreset,
  presetText: string,
  note: string,
): string {
  const trimmed = note.trim();
  if (preset === "other") return trimmed;
  return trimmed ? `${presetText}. ${trimmed}` : presetText;
}

export function RejectSubmissionDialog({
  submissionTitle,
  duplicateTitle,
  open,
  onOpenChange,
  onReject,
  busy,
  handledElsewhere,
  onCloseAutoFocus,
}: {
  submissionTitle: string;
  /** The catalogue puzzle the duplicate check matched, if any: preselects "Duplicate of …". */
  duplicateTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (reason: string) => Promise<void>;
  busy: boolean;
  /** That submission is no longer pending (decided by someone else): nothing to reject. */
  handledElsewhere: boolean;
  /** Where focus goes when the dialog closes (default: back to what opened it). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("admin.moderation.rejectDialog");
  const tCommon = useTranslations("common");
  const ids = useId();
  const [preset, setPreset] = useState<RejectPreset | null>(
    duplicateTitle ? "duplicate" : null,
  );
  const [note, setNote] = useState("");

  const presetText = (value: RejectPreset) =>
    value === "duplicate"
      ? t("presets.duplicate", {
          hasTitle: duplicateTitle ? "yes" : "no",
          title: duplicateTitle ?? "",
        })
      : t(`presets.${value}`);
  const reason = preset
    ? composeRejectionReason(preset, presetText(preset), note)
    : "";
  const noteRequired = preset === "other";
  const canReject = reason !== "" && !busy && !handledElsewhere;

  const noteId = `${ids}-note`;
  const hintId = `${ids}-hint`;
  const counterId = `${ids}-counter`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canReject) void onReject(reason);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description", { title: submissionTitle })}
            </DialogDescription>
          </DialogHeader>
          {handledElsewhere && (
            <p
              role="alert"
              className="rounded-lg border border-jigsaw-warning/30 bg-jigsaw-warning/10 px-3.5 py-3 text-sm"
            >
              {t("handledElsewhere")}
            </p>
          )}

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">
              {t("reasonLegend")}
            </legend>
            {REJECT_PRESETS.map((value) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent/50 md:min-h-9"
              >
                <input
                  type="radio"
                  name={`${ids}-preset`}
                  value={value}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                  required
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {presetText(value)}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>{t("noteLabel")}</Label>
            <Textarea
              id={noteId}
              value={note}
              maxLength={MAX_REJECT_NOTE}
              required={noteRequired}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={`${hintId} ${counterId}`}
              rows={3}
            />
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <p id={hintId}>
                {t("noteHint", { required: noteRequired ? "yes" : "no" })}
              </p>
              <p id={counterId} className="shrink-0">
                {t("noteCounter", {
                  count: note.length,
                  max: MAX_REJECT_NOTE,
                })}
              </p>
            </div>
          </div>

          {reason && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t("previewLabel")}</p>
              <p className="rounded-md bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]">
                {reason}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              className="h-11 md:h-9"
              disabled={!canReject}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
