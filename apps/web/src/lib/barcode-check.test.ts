import { describe, expect, it } from "vitest";
import { barcodeFieldOk, isValidEan, isValidUpc } from "./barcode-check";

// The domain's barcode.spec.ts samples, so the form refuses exactly what the server does.
describe("isValidEan", () => {
  it("accepts a valid EAN-13", () => {
    expect(isValidEan("4006381333931")).toBe(true);
  });

  it.each([
    ["too short (12 digits)", "400638133393"],
    ["too long (14 digits)", "40063813339310"],
    ["a leading non-digit", "X006381333931"],
    ["a trailing non-digit", "400638133393X"],
    ["a non-digit in the middle", "40063A1333931"],
    ["a check digit one too low", "4006381333930"],
    ["a check digit one too high", "4006381333932"],
  ])("refuses %s", (_label, value) => {
    expect(isValidEan(value)).toBe(false);
  });
});

describe("isValidUpc", () => {
  it("accepts a valid UPC-A", () => {
    expect(isValidUpc("036000291452")).toBe(true);
  });

  it.each([
    ["too short (11 digits)", "03600029145"],
    ["too long (13 digits)", "0360002914520"],
    ["a leading non-digit", "X36000291452"],
    ["a trailing non-digit", "03600029145X"],
    ["a wrong check digit", "036000291451"],
  ])("refuses %s", (_label, value) => {
    expect(isValidUpc(value)).toBe(false);
  });
});

describe("barcodeFieldOk", () => {
  it("lets an empty field through, since both codes are optional", () => {
    expect(barcodeFieldOk("ean", "")).toBe(true);
    expect(barcodeFieldOk("upc", "   ")).toBe(true);
  });

  it("checks the code without the spaces around it", () => {
    expect(barcodeFieldOk("ean", " 4006381333931 ")).toBe(true);
    expect(barcodeFieldOk("upc", "036000291452 ")).toBe(true);
  });

  it("checks each field by its own rule", () => {
    expect(barcodeFieldOk("ean", "036000291452")).toBe(false);
    expect(barcodeFieldOk("upc", "4006381333931")).toBe(false);
    expect(barcodeFieldOk("ean", "4006381333930")).toBe(false);
  });
});
