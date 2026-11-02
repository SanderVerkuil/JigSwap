import type {
  HouseholdCopyView,
  InProgressSolveView,
  LoanView,
  OwnedCopyView,
} from "@jigswap/contracts";

// What the "Log a solve" picker offers, in this order:
// - inProgress: the member's unfinished solves. Picking one finishes it.
// - own: the member's own copies.
// - borrowed: copies they hold on loan.
// - household: their household members' copies.
// The last three match the server's gate for logging a solve (solving/solvableCopy.ts: owner,
// current holder or household member). A copy with a solve in progress is listed only once, as
// the solve to finish, so picking a puzzle never silently turns into finishing one.
export type SolvePickerSectionId =
  "inProgress" | "own" | "borrowed" | "household";

// What picking an item does. `copyId` and `completionId` are aggregate ids (what the mutations
// take). Only the owner is offered to update a copy's missing-pieces count (viewerIsOwner).
export type SolvePickTarget =
  | { kind: "finish"; completionId: string; startDate: number }
  | { kind: "log"; copyId: string; viewerIsOwner: boolean };

export interface SolvePickerItem {
  key: string;
  // Absent only for an in-progress solve whose puzzle has no title left; the picker shows a label.
  title?: string;
  brand?: string;
  pieceCount?: number;
  imageUrl?: string;
  // A household copy's owner, as a display name.
  ownerName?: string;
  target: SolvePickTarget;
}

export interface SolvePickerSection {
  id: SolvePickerSectionId;
  items: SolvePickerItem[];
}

type CopyInput = Pick<OwnedCopyView, "aggregateId" | "coverUrl"> & {
  puzzle: Pick<
    NonNullable<OwnedCopyView["puzzle"]>,
    "title" | "brand" | "pieceCount" | "images"
  > | null;
  snapshot?: Pick<
    NonNullable<OwnedCopyView["snapshot"]>,
    "title" | "brand" | "pieceCount"
  >;
};

type HouseholdOwner = HouseholdCopyView["household"]["owner"];

export interface SolvePickerSources {
  inProgress: readonly InProgressSolveView[];
  owned: readonly CopyInput[];
  borrowed: readonly Pick<LoanView, "copyId" | "puzzleTitle" | "pieceCount">[];
  household: readonly (CopyInput & {
    household: { owner: HouseholdOwner };
  })[];
  // Resolves a household member's display name (useMemberDisplayName).
  nameOf: (owner: HouseholdOwner) => string;
}

// A copy as a picker row, or null when no solve can be logged against it yet (no aggregate id).
function copyItem(
  copy: CopyInput,
  viewerIsOwner: boolean,
): SolvePickerItem | null {
  if (!copy.aggregateId) return null;
  return {
    key: copy.aggregateId,
    title: copy.puzzle?.title ?? copy.snapshot?.title,
    brand: copy.puzzle?.brand ?? copy.snapshot?.brand,
    pieceCount: copy.puzzle?.pieceCount ?? copy.snapshot?.pieceCount,
    imageUrl: copy.coverUrl ?? copy.puzzle?.images?.[0],
    target: { kind: "log", copyId: copy.aggregateId, viewerIsOwner },
  };
}

const isPresent = <T>(value: T | null): value is T => value !== null;

export function buildSolvePickerSections(
  sources: SolvePickerSources,
): SolvePickerSection[] {
  const own = sources.owned
    .map((copy) => copyItem(copy, true))
    .filter(isPresent);
  const borrowed: SolvePickerItem[] = sources.borrowed.map((loan) => ({
    key: loan.copyId,
    title: loan.puzzleTitle,
    pieceCount: loan.pieceCount,
    target: { kind: "log", copyId: loan.copyId, viewerIsOwner: false },
  }));
  const borrowedIds = new Set(borrowed.map((item) => item.key));
  const household = sources.household
    .filter((copy) => !copy.aggregateId || !borrowedIds.has(copy.aggregateId))
    .map((copy) => {
      const item = copyItem(copy, false);
      return (
        item && { ...item, ownerName: sources.nameOf(copy.household.owner) }
      );
    })
    .filter(isPresent);

  // The copy behind an in-progress solve, when the member can still see it, lends the row its
  // cover and brand (the solve itself only carries catalogue box art).
  const copyById = new Map(
    [...own, ...borrowed, ...household].map((item) => [item.key, item]),
  );
  const inProgress: SolvePickerItem[] = sources.inProgress.map((solve) => {
    const copy = solve.copyId ? copyById.get(solve.copyId) : undefined;
    return {
      key: solve.completionId,
      title: solve.title ?? copy?.title,
      brand: copy?.brand,
      pieceCount: solve.pieceCount ?? copy?.pieceCount,
      imageUrl: copy?.imageUrl ?? solve.thumbnailUrl,
      target: {
        kind: "finish",
        completionId: solve.completionId,
        startDate: solve.startDate,
      },
    };
  });
  const inProgressCopyIds = new Set(
    sources.inProgress.flatMap((solve) => (solve.copyId ? [solve.copyId] : [])),
  );
  const notInProgress = (item: SolvePickerItem) =>
    !inProgressCopyIds.has(item.key);

  return [
    { id: "inProgress", items: inProgress },
    { id: "own", items: own.filter(notInProgress) },
    { id: "borrowed", items: borrowed.filter(notInProgress) },
    { id: "household", items: household.filter(notInProgress) },
  ];
}

// Keeps the items whose title, brand or owner contains the search term (case-insensitive), in
// every section. A blank term keeps everything.
export function filterSolvePickerSections(
  sections: readonly SolvePickerSection[],
  term: string,
): readonly SolvePickerSection[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return sections;
  const matches = (item: SolvePickerItem) =>
    [item.title, item.brand, item.ownerName].some((field) =>
      field?.toLowerCase().includes(needle),
    );
  return sections.map((section) => ({
    ...section,
    items: section.items.filter(matches),
  }));
}
