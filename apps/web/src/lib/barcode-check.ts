// The catalogue's barcode rules, mirrored from packages/domain/src/catalog/domain/barcode.ts (Ean,
// Upc) so a form can say a code is wrong before the server refuses it. The web tier doesn't depend
// on @jigswap/domain, so keep the two in step: an EAN-13 is 13 digits and a UPC-A 12, each ending
// in a GS1 mod-10 check digit.

const isAllDigits = (value: string): boolean => /^[0-9]+$/.test(value);

// Weight the digits 3-1-3-… from the right (leaving out the check digit) and sum them; the check
// digit makes the total a multiple of 10.
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

export const isValidEan = (value: string): boolean =>
  value.length === 13 && isAllDigits(value) && hasValidCheckDigit(value);

export const isValidUpc = (value: string): boolean =>
  value.length === 12 && isAllDigits(value) && hasValidCheckDigit(value);

/** Whether an EAN or UPC field can be sent as it is: empty (both are optional) or a valid code. */
export function barcodeFieldOk(kind: "ean" | "upc", value: string): boolean {
  const code = value.trim();
  if (code === "") return true;
  return kind === "ean" ? isValidEan(code) : isValidUpc(code);
}
