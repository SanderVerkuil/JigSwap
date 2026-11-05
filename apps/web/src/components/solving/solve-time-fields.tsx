"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserSettings } from "@/hooks/use-user-settings";
import { hasSolveFormErrors, type SolveFormErrors } from "@/lib/solve-form";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The member's "track solve times" preference, undefined until they choose. Time fields show
// unless they turned it off, so a first solve's time can be entered in the dialog itself.
export function showsSolveTime(
  trackCompletionDuration: boolean | undefined,
): boolean {
  return trackCompletionDuration !== false;
}

// "Don't track times" for the Log and Finish dialogs: offered only while the member hasn't chosen
// yet (and their settings have loaded), undefined otherwise. It stores false, so the time fields
// hide once the setting updates, and says where to turn times back on.
export function useSolveTimeOptOut(): (() => void) | undefined {
  const t = useTranslations("solving.logSolve");
  const { isLoading, trackCompletionDuration, setTrackDuration } =
    useUserSettings();
  if (isLoading || trackCompletionDuration !== undefined) return undefined;
  return () => {
    setTrackDuration(false).then(
      () => toast.success(t("timesOff")),
      (error: unknown) => {
        console.error("Failed to turn off solve times:", error);
        toast.error(t("timesOffError"));
      },
    );
  };
}

// What to fix on a field of a solve form, next to that field.
export function SolveFieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive mt-1.5 text-xs">
      {message}
    </p>
  );
}

// The inline errors of a solve form, shown as the goal form shows its own: Save stays enabled, it
// checks the whole form, says what to fix next to each field and moves focus to the first one.
// `fieldIds` are the inputs to focus: the fields this form has.
export function useSolveFormErrors(fieldIds: {
  start?: string;
  end?: string;
  time?: string;
}) {
  const t = useTranslations("solving.logSolve");
  const [errors, setErrors] = useState<SolveFormErrors>({});

  const show = (next: SolveFormErrors) => {
    setErrors(next);
    if (!hasSolveFormErrors(next)) return;
    const first = (["start", "end", "time"] as const).find((f) => next[f]);
    const id = first && fieldIds[first];
    if (id) document.getElementById(id)?.focus();
  };
  // Either date can fix or cause an error on the end date, so a date change clears both.
  const clearDates = () =>
    setErrors((current) => ({
      ...current,
      start: undefined,
      end: undefined,
    }));
  const clearTime = () =>
    setErrors((current) => ({ ...current, time: undefined }));

  const endError =
    errors.end &&
    t(
      errors.end === "required"
        ? "dateRequired"
        : errors.end === "future"
          ? "endInFutureError"
          : "endBeforeStartError",
    );

  return {
    show,
    clearDates,
    clearTime,
    startError: errors.start && t("dateRequired"),
    endError,
    timeError:
      errors.time &&
      t(errors.time === "impossible" ? "invalidDuration" : "timeInvalid"),
  };
}

interface SolveTimeFieldsProps {
  // Prefix for the input ids (one dialog may sit next to another on the page).
  idPrefix: string;
  hours: string;
  minutes: string;
  onHoursChange: (value: string) => void;
  onMinutesChange: (value: string) => void;
  // Offered while the member hasn't chosen yet: turns the time question off for good (it can be
  // turned back on under Preferences).
  onOptOut?: () => void;
  // What to fix, shown under the fields (useSolveFormErrors).
  error?: string;
}

// The optional "How long did it take?" question shared by the Log, Finish and Edit solve
// dialogs. Hours and minutes each carry a visible label; the dialogs store their sum in minutes.
export function SolveTimeFields({
  idPrefix,
  hours,
  minutes,
  onHoursChange,
  onMinutesChange,
  onOptOut,
  error,
}: SolveTimeFieldsProps) {
  const t = useTranslations("solving.logSolve");
  const errorId = `${idPrefix}-error`;
  const invalid = error
    ? { "aria-invalid": true, "aria-describedby": errorId }
    : {};
  return (
    <fieldset className="min-w-0">
      {/* leading-snug, not the labels' leading-none: the question wraps on phones (e.g. Dutch). */}
      <legend className="mb-2 text-sm leading-snug font-medium">
        {t("timeQuestion")}
      </legend>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label
            htmlFor={`${idPrefix}-hours`}
            className="text-muted-foreground text-xs"
          >
            {t("hours")}
          </Label>
          <Input
            id={`${idPrefix}-hours`}
            type="number"
            min={0}
            inputMode="numeric"
            value={hours}
            onChange={(e) => onHoursChange(e.target.value)}
            {...invalid}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`${idPrefix}-minutes`}
            className="text-muted-foreground text-xs"
          >
            {t("minutes")}
          </Label>
          <Input
            id={`${idPrefix}-minutes`}
            type="number"
            min={0}
            max={59}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => onMinutesChange(e.target.value)}
            {...invalid}
          />
        </div>
      </div>
      <SolveFieldError id={errorId} message={error} />
      {onOptOut && (
        <button
          type="button"
          onClick={onOptOut}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 inline-flex items-center rounded-sm py-1 text-xs underline underline-offset-2 outline-none focus-visible:ring-2 pointer-coarse:min-h-9"
        >
          {t("dontTrackTimes")}
        </button>
      )}
    </fieldset>
  );
}
