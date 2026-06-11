import { err, ok, Result } from "../../shared-kernel";
import { CatalogError } from "./errors";

const isAllDigits = (value: string): boolean => /^[0-9]+$/.test(value);

// GS1 mod-10 check digit (shared by EAN-13 and UPC-A): weight digits 3-1-3-… from the right
// (excluding the check digit), sum, and the check digit makes the total a multiple of 10.
const hasValidCheckDigit = (digits: string): boolean => {
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === check;
};

// European Article Number: 13 digits with a valid GS1 check digit.
export class Ean {
  private constructor(readonly value: string) {}

  static create(value: string): Result<Ean, CatalogError> {
    if (value.length !== 13 || !isAllDigits(value)) {
      return err(CatalogError.invalidBarcode("EAN", "must be 13 digits"));
    }
    if (!hasValidCheckDigit(value)) {
      return err(
        CatalogError.invalidBarcode("EAN", "check digit does not match"),
      );
    }
    return ok(new Ean(value));
  }
}

// Universal Product Code (UPC-A): 12 digits with a valid GS1 check digit.
export class Upc {
  private constructor(readonly value: string) {}

  static create(value: string): Result<Upc, CatalogError> {
    if (value.length !== 12 || !isAllDigits(value)) {
      return err(CatalogError.invalidBarcode("UPC", "must be 12 digits"));
    }
    if (!hasValidCheckDigit(value)) {
      return err(
        CatalogError.invalidBarcode("UPC", "check digit does not match"),
      );
    }
    return ok(new Upc(value));
  }
}

// Manufacturer model number: an opaque, non-blank identifier with no standard format.
export class ModelNumber {
  private constructor(readonly value: string) {}

  static create(value: string): Result<ModelNumber, CatalogError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err(
        CatalogError.invalidBarcode("model number", "must not be blank"),
      );
    }
    return ok(new ModelNumber(trimmed));
  }
}

// Raw, all-optional barcode input as it arrives from the boundary.
export interface BarcodesInput {
  readonly ean?: string;
  readonly upc?: string;
  readonly modelNumber?: string;
}

// Validated grouping of a definition's product identifiers; any present field is well-formed.
export interface Barcodes {
  readonly ean?: Ean;
  readonly upc?: Upc;
  readonly modelNumber?: ModelNumber;
}

// Validate whichever identifiers are present, short-circuiting on the first malformed one.
export const validateBarcodes = (
  input: BarcodesInput,
): Result<Barcodes, CatalogError> => {
  let ean: Ean | undefined;
  let upc: Upc | undefined;
  let modelNumber: ModelNumber | undefined;

  if (input.ean !== undefined) {
    const r = Ean.create(input.ean);
    if (r.isErr) return err(r.error);
    ean = r.value;
  }
  if (input.upc !== undefined) {
    const r = Upc.create(input.upc);
    if (r.isErr) return err(r.error);
    upc = r.value;
  }
  if (input.modelNumber !== undefined) {
    const r = ModelNumber.create(input.modelNumber);
    if (r.isErr) return err(r.error);
    modelNumber = r.value;
  }

  return ok({ ean, upc, modelNumber });
};
