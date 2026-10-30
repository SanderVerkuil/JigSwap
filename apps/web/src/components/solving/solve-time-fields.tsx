"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "use-intl";

// The member's "track solve times" preference, undefined until they choose. Time fields show
// unless they turned it off, so a first solve's time can be entered in the dialog itself.
export function showsSolveTime(
  trackCompletionDuration: boolean | undefined,
): boolean {
  return trackCompletionDuration !== false;
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
}: SolveTimeFieldsProps) {
  const t = useTranslations("solving.logSolve");
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm leading-none font-medium">
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
          />
        </div>
      </div>
      {onOptOut && (
        <button
          type="button"
          onClick={onOptOut}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-1 inline-flex items-center rounded-sm py-1 text-xs underline underline-offset-2 outline-none focus-visible:ring-[3px] pointer-coarse:min-h-9"
        >
          {t("dontTrackTimes")}
        </button>
      )}
    </fieldset>
  );
}
