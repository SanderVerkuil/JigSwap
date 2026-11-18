import {
  BARCODE_HOLDING_STATUSES,
  BarcodesInput,
  PuzzleDefinitionId,
} from "../../domain";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

// The cross-aggregate barcode-uniqueness rule: return the first supplied barcode that another
// definition already holds (see BARCODE_HOLDING_STATUSES), else null. `excluding` is the
// definition being edited, so restating its own barcodes is never a clash. Format validity is
// the aggregate's job; here we only check uniqueness of the raw values.
export const firstDuplicateBarcode = async (
  definitions: PuzzleDefinitionRepository,
  barcodes: BarcodesInput | undefined,
  excluding?: PuzzleDefinitionId,
): Promise<string | null> => {
  const candidates = [
    barcodes?.ean,
    barcodes?.upc,
    barcodes?.modelNumber,
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const barcode of candidates) {
    // A UPC-A and its 0-prefixed EAN-13 are the same barcode: probe the twin too.
    const twin = /^0\d{12}$/.test(barcode)
      ? barcode.slice(1)
      : /^\d{12}$/.test(barcode)
        ? `0${barcode}`
        : undefined;
    for (const probe of twin ? [barcode, twin] : [barcode]) {
      const holder = await definitions.findByBarcode(probe, {
        statuses: BARCODE_HOLDING_STATUSES,
        excluding,
      });
      if (holder) return barcode;
    }
  }
  return null;
};
