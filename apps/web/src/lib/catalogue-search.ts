// Pure helpers for the add-copy catalogue picker.

// A barcode-shaped input (UPC-A or EAN-13) with spaces/dashes stripped, or null. EAN-8 is left
// out: the catalogue doesn't store it, so 8 digits fall through to the text search. The server
// re-checks this; here it only decides whether to run the barcode lookup.
export function detectBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^(\d{12}|\d{13})$/.test(digits) ? digits : null;
}

// The value the search is debounced on and sent with: trimmed, lowercased, whitespace collapsed,
// so cosmetic edits (case, a trailing space) don't fire a new server query.
export function catalogueSearchKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
