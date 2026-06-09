import { describe, expect, it } from "vitest";
import { Ean, ModelNumber, Upc, validateBarcodes } from "./barcode";

describe("Ean", () => {
  it("accepts a valid EAN-13 with a correct check digit", () => {
    // 4006381333931 is a textbook-valid EAN-13.
    const r = Ean.create("4006381333931");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.value).toBe("4006381333931");
  });

  it.each([
    ["wrong length", "400638133393"],
    ["non-digits", "40063813339AB"],
    ["bad check digit", "4006381333930"],
  ])("rejects %s with InvalidBarcode", (_label, value) => {
    const r = Ean.create(value);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
  });
});

describe("Upc", () => {
  it("accepts a valid UPC-A with a correct check digit", () => {
    // 036000291452 is a textbook-valid UPC-A.
    const r = Upc.create("036000291452");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.value).toBe("036000291452");
  });

  it.each([
    ["wrong length", "03600029145"],
    ["non-digits", "03600029145X"],
    ["bad check digit", "036000291451"],
  ])("rejects %s with InvalidBarcode", (_label, value) => {
    const r = Upc.create(value);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
  });
});

describe("ModelNumber", () => {
  it("trims and accepts a non-blank model number", () => {
    const r = ModelNumber.create("  RV-12345  ");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.value).toBe("RV-12345");
  });

  it("rejects a blank model number", () => {
    const r = ModelNumber.create("   ");
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
  });
});

describe("validateBarcodes", () => {
  it("validates only the present identifiers", () => {
    const r = validateBarcodes({ ean: "4006381333931" });
    expect(r.isOk).toBe(true);
    if (r.isOk) {
      expect(r.value.ean?.value).toBe("4006381333931");
      expect(r.value.upc).toBeUndefined();
    }
  });

  it("short-circuits on the first malformed identifier", () => {
    const r = validateBarcodes({ ean: "4006381333931", upc: "bad" });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
  });

  it("returns an empty grouping when nothing is supplied", () => {
    const r = validateBarcodes({});
    expect(r.isOk).toBe(true);
    if (r.isOk) {
      expect(r.value.ean).toBeUndefined();
      expect(r.value.upc).toBeUndefined();
      expect(r.value.modelNumber).toBeUndefined();
    }
  });
});
