import { dateInputToMs } from "@/lib/date-input";

// Pure helpers behind the bulk "I've solved these" rows (quick start step 2, PastSolvesForm).

// The earliest year the "Which year" select offers (spec 2026-10-17 §2.4).
const FIRST_YEAR = 1950;

export type PastSolveWhen = "unknown" | "year" | "day";

// One ticked row's answer to "When?": the chosen option plus the year and date inputs' values
// (`date` is the `yyyy-mm-dd` of a date input, empty until picked).
export interface PastSolveChoice {
  when: PastSolveWhen;
  year: number;
  date: string;
}

export type PastCompletionItem = {
  copyId: string;
  datePrecision: PastSolveWhen;
  date?: number;
  year?: number;
};

// The member's own copies with no completion yet (finished or in progress), newest first. Copies
// without an aggregateId can't be logged by recordPastCompletions, so they're left out.
export function pastSolveCandidates<
  C extends { _id: string; aggregateId?: string; createdAt: number },
>(copies: readonly C[], solvedCopyIds: ReadonlySet<string>): C[] {
  return copies
    .filter((c) => c.aggregateId !== undefined && !solvedCopyIds.has(c._id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// The recordPastCompletions item for one ticked row, or null while "Pick a date" has no date yet or
// one after `today` (the member's local today as a `yyyy-mm-dd`; the server refuses a later one and
// would fail the whole batch). It never invents a date: "I don't remember" sends none and "Which
// year" sends only the year.
export function toPastCompletionItem(
  copyId: string,
  choice: PastSolveChoice,
  today: string,
): PastCompletionItem | null {
  if (choice.when === "unknown") return { copyId, datePrecision: "unknown" };
  if (choice.when === "year") {
    return { copyId, datePrecision: "year", year: choice.year };
  }
  const date = dateInputToMs(choice.date);
  if (date === undefined || choice.date > today) return null;
  return { copyId, datePrecision: "day", date };
}

// The "Which year" options: this year down to 1950.
export function yearOptions(currentYear: number): number[] {
  return Array.from(
    { length: currentYear - FIRST_YEAR + 1 },
    (_, i) => currentYear - i,
  );
}
