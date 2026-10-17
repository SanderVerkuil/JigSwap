// Pure helpers for the add-copy catalogue picker.

// A barcode-shaped input (EAN-8, UPC-A or EAN-13) with spaces/dashes stripped, or null. The
// server re-checks this; here it only decides whether to run the barcode lookup.
export function detectBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^(\d{8}|\d{12}|\d{13})$/.test(digits) ? digits : null;
}

// The value the search is debounced on and sent with: trimmed, lowercased, whitespace collapsed,
// so cosmetic edits (case, a trailing space) don't fire a new server query.
export function catalogueSearchKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
