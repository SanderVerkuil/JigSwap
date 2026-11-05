// Readers for typed URL search params, shared by the validators of /puzzles and /browse.
//
// TanStack Router merges a route's validateSearch result OVER the raw params
// ({ ...raw, ...validated }), so Route.useSearch() still holds the raw value of any key a validator
// leaves out. A validator therefore returns EVERY key it knows, `undefined` when the value is
// unusable: that is what actually drops it. Unknown keys (utm_source, ...) stay in the merged
// object, so nothing may read "the remaining keys" as if they were the validator's.
//
// The router also JSON-decodes each value, so a hand-written ?q=2000 arrives as a number and ?q=true
// as a boolean. For a text param those are what the person typed, so they are read as text.

export const textParam = (value: unknown): string | undefined => {
  const text =
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
      ? String(value)
      : value;
  return typeof text === "string" && text.trim() !== ""
    ? text.trim()
    : undefined;
};

export const piecesParam = (value: unknown): number | undefined => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
