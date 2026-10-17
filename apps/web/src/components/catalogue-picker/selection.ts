// Pure selection and row logic for the multi-select CataloguePicker. Kept free of React and
// Convex so the rules (limit, order, dedupe, owned/pending marks) are unit-tested on their own.

import { catalogueSearchKey, detectBarcode } from "@/lib/catalogue-search";

// Mirrors the backend's MAX_ACQUIRE_BATCH: one `library.acquireCopies` call takes at most 25.
export const PICK_LIMIT = 25;

export interface PickerRow {
  definitionId: string;
  title: string;
  brand?: string;
  pieceCount?: number;
  image?: string | null;
  // The caller's own not-yet-approved submission ("Pending review").
  pending: boolean;
  // The caller already owns a copy of this definition ("On your shelf").
  onShelf: boolean;
}

export interface Pick {
  definitionId: string;
  title: string;
  pending: boolean;
  forTrade: boolean;
}

type Pickable = Omit<Pick, "forTrade">;

export const isPicked = (picks: readonly Pick[], definitionId: string) =>
  picks.some((p) => p.definitionId === definitionId);

// Add the row at the end (forTrade off: the domain default), or remove it when already picked.
// A full tray ignores further adds and returns the same array.
export const togglePick = (picks: Pick[], row: Pickable): Pick[] => {
  if (isPicked(picks, row.definitionId))
    return removePick(picks, row.definitionId);
  if (picks.length >= PICK_LIMIT) return picks;
  return [
    ...picks,
    {
      definitionId: row.definitionId,
      title: row.title,
      pending: row.pending,
      forTrade: false,
    },
  ];
};

export const removePick = (picks: readonly Pick[], definitionId: string) =>
  picks.filter((p) => p.definitionId !== definitionId);

// Backspace in an empty search removes the most recent pick.
export const removeLastPick = (picks: readonly Pick[]) => picks.slice(0, -1);

export const setPickForTrade = (
  picks: readonly Pick[],
  definitionId: string,
  forTrade: boolean,
) =>
  picks.map((p) => (p.definitionId === definitionId ? { ...p, forTrade } : p));

// The `library.acquireCopies` items for the tray.
export const toAcquireItems = (picks: readonly Pick[]) =>
  picks.map((p) => ({
    puzzleDefinitionId: p.definitionId,
    forTrade: p.forTrade,
  }));

interface SourceRow {
  aggregateId?: string;
  title: string;
  brand?: string;
  pieceCount?: number;
  image?: string | null;
}

const matches = (row: SourceRow, term: string) => {
  const q = term.toLowerCase();
  return (
    row.title.toLowerCase().includes(q) ||
    (!!row.brand && row.brand.toLowerCase().includes(q))
  );
};

// The rows to show: the caller's own pending submissions that match the term first (a blank term
// shows all of them, so a just-registered puzzle is there on return), then the server's search
// results. Rows without an aggregate id cannot be acquired and are dropped; a result that is also
// an own submission is shown once.
export const buildPickerRows = ({
  term,
  results,
  mySubmissions,
  ownedDefinitionIds,
}: {
  term: string;
  results: readonly SourceRow[];
  mySubmissions: readonly SourceRow[];
  ownedDefinitionIds: ReadonlySet<string>;
}): PickerRow[] => {
  const trimmed = term.trim();
  const toRow = (row: SourceRow, pending: boolean): PickerRow => ({
    definitionId: row.aggregateId!,
    title: row.title,
    brand: row.brand,
    pieceCount: row.pieceCount,
    image: row.image,
    pending,
    onShelf: ownedDefinitionIds.has(row.aggregateId!),
  });
  const own = mySubmissions
    .filter((row) => row.aggregateId && (!trimmed || matches(row, trimmed)))
    .map((row) => toRow(row, true));
  if (!trimmed) return own;
  const seen = new Set(own.map((r) => r.definitionId));
  const found = results
    .filter((row) => row.aggregateId && !seen.has(row.aggregateId))
    .map((row) => toRow(row, false));
  return [...own, ...found];
};

// Which catalogue read a term runs, using the add flow's rules: a 12/13-digit code runs the barcode
// lookup (`catalog.lookupBarcode`) instead of the text search (`catalog.search`), which gets the
// normalised term; a blank term runs neither.
export const pickerSearchQuery = (
  term: string,
): { searchTerm: string | null; barcode: string | null } => {
  const key = catalogueSearchKey(term);
  const barcode = detectBarcode(key);
  return { searchTerm: key && !barcode ? key : null, barcode };
};

// The search results the rows are built from: the barcode match alone (none when the code is
// unknown) while a barcode is looked up, otherwise the text search's loaded page.
export const pickerSearchResults = <Row>({
  barcode,
  barcodeMatch,
  page,
}: {
  barcode: string | null;
  barcodeMatch: Row | null | undefined;
  page: readonly Row[];
}): readonly Row[] => {
  if (!barcode) return page;
  return barcodeMatch ? [barcodeMatch] : [];
};

// "Can't find it? Register it": the search params for the full add form (/my-puzzles/add/new),
// with the query as the title (or, for an unknown barcode, as its EAN/UPC, like the add flow) and
// a way back to the picker.
export const registerSearch = (query: string, returnTo: string | undefined) => {
  const { barcode } = pickerSearchQuery(query);
  return {
    title: barcode ? undefined : query.trim() || undefined,
    ean: barcode && barcode.length === 13 ? barcode : undefined,
    upc: barcode && barcode.length === 12 ? barcode : undefined,
    returnTo,
  };
};
