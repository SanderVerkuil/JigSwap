import { foldForSearch } from "@/lib/catalogue-search";
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

// One row's facts: enough to recognise the box in hand, and tell same-titled copies apart.
export interface PastSolveCandidate {
  copyId: string;
  title: string;
  brand?: string;
  pieceCount?: number;
}

// A row writes its piece count the way the member's language does ("3.000", "3,000"), and the search
// looks at the plain number, so both sides lose the separators.
const searchable = (text: string): string =>
  foldForSearch(text).replace(/(?<=\d)[.,](?=\d)/g, "");

// Which rows show for a search and a page size. Every word must appear in the title, brand or piece
// count. A ticked row a search hides keeps its tick, unless it is `waiting` (it can't be logged yet):
// that one holds the submit back, so it stays in reach. A ticked row also stays past the page, so
// one found through a search doesn't vanish when the search is cleared. `noMatch` is about the
// search alone: a waiting row showing doesn't make it a match.
export function pastSolveRows<C extends PastSolveCandidate>(
  candidates: readonly C[],
  {
    term,
    shown,
    ticked,
    waiting,
  }: {
    term: string;
    shown: number;
    ticked: { has: (copyId: string) => boolean };
    waiting: { has: (copyId: string) => boolean };
  },
): { rows: C[]; more: boolean; noMatch: boolean } {
  const words = searchable(term).split(/\s+/).filter(Boolean);
  const found = new Set(
    candidates.filter((candidate) => {
      const haystack = searchable(
        [candidate.title, candidate.brand, candidate.pieceCount].join(" "),
      );
      return words.every((word) => haystack.includes(word));
    }),
  );
  const matching = candidates.filter(
    (candidate) => found.has(candidate) || waiting.has(candidate.copyId),
  );
  const rows = matching.filter(
    (candidate, index) => index < shown || ticked.has(candidate.copyId),
  );
  return {
    rows,
    more: rows.length < matching.length,
    noMatch: found.size === 0,
  };
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
