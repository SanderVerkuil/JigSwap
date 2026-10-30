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
    const holder = await definitions.findByBarcode(barcode, {
      statuses: BARCODE_HOLDING_STATUSES,
      excluding,
    });
    if (holder) return barcode;
  }
  return null;
};
