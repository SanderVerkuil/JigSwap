import { dateInputToMs, localTodayInput, msToDateInput } from "./date-input";

// The goal form's rules, kept pure so they can be tested: what the form accepts and what it
// sends. Goal dates follow lib/date-input: a calendar date stored as
// UTC midnight, with "today" taken from the member's local calendar. The server re-checks the
// target and the period (solving/domain/goal.ts); these rules only make the form say why it
// refuses before anything is sent.

// A new goal's period: this calendar year, so "10 this year" means what it says.
export function defaultGoalPeriod(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const year = localTodayInput(now).slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export type TargetError = "required" | "invalid";

// The target as typed: a whole number of at least 1 (the server refuses anything else).
export function parseTarget(
  raw: string,
): { ok: true; value: number } | { ok: false; error: TargetError } {
  const value = raw.trim();
  if (value === "") return { ok: false, error: "required" };
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, error: "invalid" };
  return { ok: true, value: n };
}

// The form's fields as typed (date fields hold `yyyy-mm-dd` or "").
export interface GoalFormValues {
  title: string;
  description: string;
  target: string;
  from: string;
  to: string;
}

export interface GoalFormErrors {
  title?: "required";
  target?: TargetError;
  to?: "beforeFrom" | "past";
}

// What createGoal/updateGoal take. Dates are UTC-midnight ms; an omitted field is cleared on update.
export interface GoalDefinitionInput {
  title: string;
  description?: string;
  targetCompletions: number;
  startDate?: number;
  targetDate?: number;
}

export type GoalFormMode = "create" | "edit";

// The form's starting values: an empty goal over this year, or the goal being edited. A goal set
// before periods existed has no start date and counts from the day it was created, so its form
// shows that day.
export function goalFormValues(
  goal?: {
    title: string;
    description?: string;
    targetCompletions: number;
    startDate?: number;
    targetDate?: number;
    createdAt: number;
  },
  now: Date = new Date(),
): GoalFormValues {
  if (!goal) {
    return {
      title: "",
      description: "",
      target: "",
      ...defaultGoalPeriod(now),
    };
  }
  return {
    title: goal.title,
    description: goal.description ?? "",
    target: String(goal.targetCompletions),
    from: msToDateInput(goal.startDate ?? goal.createdAt),
    to: msToDateInput(goal.targetDate),
  };
}

// The earliest end date the date picker offers: never before the start date, and when creating
// never before today (an edit may keep a past end date, e.g. to rename an ended goal).
export function minGoalEndDate(
  values: Pick<GoalFormValues, "from">,
  mode: GoalFormMode,
  now: Date = new Date(),
): string | undefined {
  const from = values.from || undefined;
  if (mode === "edit") return from;
  const today = localTodayInput(now);
  // `yyyy-mm-dd` strings sort as dates.
  return from !== undefined && from > today ? from : today;
}

// Check the whole form at once and, when it is valid, build what the mutation takes.
export function validateGoalForm(
  values: GoalFormValues,
  { mode, now = new Date() }: { mode: GoalFormMode; now?: Date },
):
  | { ok: true; definition: GoalDefinitionInput }
  | { ok: false; errors: GoalFormErrors } {
  const errors: GoalFormErrors = {};

  const title = values.title.trim();
  if (title === "") errors.title = "required";

  const target = parseTarget(values.target);
  if (!target.ok) errors.target = target.error;

  const startDate = dateInputToMs(values.from);
  const targetDate = dateInputToMs(values.to);
  if (targetDate !== undefined) {
    if (startDate !== undefined && targetDate < startDate) {
      errors.to = "beforeFrom";
    } else if (
      mode === "create" &&
      targetDate < (dateInputToMs(localTodayInput(now)) ?? 0)
    ) {
      errors.to = "past";
    }
  }

  if (!target.ok || Object.keys(errors).length > 0)
    return { ok: false, errors };
  return {
    ok: true,
    definition: {
      title,
      description: values.description.trim() || undefined,
      targetCompletions: target.value,
      startDate,
      targetDate,
    },
  };
}

// A refusal from createGoal/updateGoal (solving/errors code) as an error on the field it is
// about; undefined for anything the form can't point at.
export function goalFormErrorsFromCode(
  code: string | undefined,
): GoalFormErrors | undefined {
  if (code === "InvalidGoalTarget") return { target: "invalid" };
  if (code === "InvalidGoalPeriod") return { to: "beforeFrom" };
  return undefined;
}
