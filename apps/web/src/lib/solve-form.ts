// The rules of the solve forms (Log, Edit and Finish), kept pure so they can be tested: what each
// accepts and what it sends. Dates are `yyyy-mm-dd` input values, so they compare as strings. The
// server re-checks all of it (solving/domain/completion.ts); these rules make the form say why it
// refuses before anything is sent, next to the field.

// A field the form doesn't have is left out of the values: Finish has no start, a solve still going
// has no end, and a member who turned times off has no time.
export interface SolveFormValues {
  start?: string;
  end?: string;
  hours?: string;
  minutes?: string;
}

export interface SolveFormErrors {
  start?: "required";
  end?: "required" | "beforeStart" | "future";
  // "impossible" is the server's refusal: whole numbers, but more than a solve can have taken.
  time?: "invalid" | "impossible";
}

const isWholeNumber = (value: string) => /^\d*$/.test(value.trim());

export function validateSolveForm(
  { start, end, hours = "", minutes = "" }: SolveFormValues,
  {
    today,
    datesRequired,
  }: {
    // The member's local today (lib/date-input localTodayInput): the latest day a solve can end.
    today: string;
    // False for a year-only or undated solve: its dates are empty until the member enters one.
    datesRequired: boolean;
  },
): SolveFormErrors {
  const errors: SolveFormErrors = {};
  if (start === "" && datesRequired) errors.start = "required";
  if (end === "" && datesRequired) errors.end = "required";
  if (end) {
    if (start && end < start) errors.end = "beforeStart";
    else if (end > today) errors.end = "future";
  }
  if (
    !isWholeNumber(hours) ||
    !isWholeNumber(minutes) ||
    Number(minutes) > 59
  ) {
    errors.time = "invalid";
  }
  return errors;
}

export const hasSolveFormErrors = (errors: SolveFormErrors): boolean =>
  Object.values(errors).some(Boolean);

// What the domain refuses, on the field it is about. Anything else stays with the form's toast.
export function solveFormErrorsFromCode(
  code: string | undefined,
): SolveFormErrors | undefined {
  if (code === "InvalidTimeRange") return { end: "beforeStart" };
  if (code === "FutureEndDate") return { end: "future" };
  if (code === "InvalidDuration") return { time: "impossible" };
  return undefined;
}

// Hours and minutes as the single minutes value the domain stores; undefined when blank or zero.
export function solveMinutes(
  hours: string,
  minutes: string,
): number | undefined {
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;
}
