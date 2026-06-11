import { describe, expect, it } from "vitest";
import { Ean, ModelNumber, Upc, validateBarcodes } from "./barcode";

describe("Ean", () => {
  it("accepts a valid EAN-13 with a correct check digit", () => {
    // 4006381333931 is a textbook-valid EAN-13.
    const r = Ean.create("4006381333931");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.value).toBe("4006381333931");
  });

  // A length/format failure and a check-digit failure share the InvalidBarcode code but carry
  // distinct messages; asserting the message pins down WHICH branch rejected (kills the
  // `||`→`&&` logical-operator mutant and the error-string mutants).
  it.each([
    ["too short (12 digits)", "400638133393", "must be 13 digits"],
    ["too long (14 digits)", "40063813339310", "must be 13 digits"],
    ["leading non-digit", "X006381333931", "must be 13 digits"],
    ["trailing non-digit", "400638133393X", "must be 13 digits"],
    ["non-digit in the middle", "40063A1333931", "must be 13 digits"],
    [
      "right length but bad check digit",
      "4006381333930",
      "check digit does not match",
    ],
  ])("rejects %s with InvalidBarcode (%s)", (_label, value, detail) => {
    const r = Ean.create(value);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidBarcode");
      expect(r.error.message).toBe(`Invalid EAN: ${detail}`);
    }
  });

  // The check digit is computed mod-10 over 3-1-3 weighted digits; nudging the last digit by
  // exactly one in either direction must break it, proving the algorithm is enforced.
  it.each(["4006381333930", "4006381333932"])(
    "rejects a one-off check digit %s",
    (value) => {
      expect(Ean.create(value).isErr).toBe(true);
    },
  );
});

describe("Upc", () => {
  it("accepts a valid UPC-A with a correct check digit", () => {
    // 036000291452 is a textbook-valid UPC-A.
    const r = Upc.create("036000291452");
    expect(r.isOk).toBe(true);
    if (r.isOk) expect(r.value.value).toBe("036000291452");
  });

  it.each([
    ["too short (11 digits)", "03600029145", "must be 12 digits"],
    ["too long (13 digits)", "0360002914520", "must be 12 digits"],
    ["leading non-digit", "X36000291452", "must be 12 digits"],
    ["trailing non-digit", "03600029145X", "must be 12 digits"],
    [
      "right length but bad check digit",
      "036000291451",
      "check digit does not match",
    ],
  ])("rejects %s with InvalidBarcode (%s)", (_label, value, detail) => {
    const r = Upc.create(value);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidBarcode");
      expect(r.error.message).toBe(`Invalid UPC: ${detail}`);
    }
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
    if (r.isErr) {
      expect(r.error.code).toBe("InvalidBarcode");
      expect(r.error.message).toBe("Invalid model number: must not be blank");
    }
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

  it("validates a present UPC and model number, surfacing the parsed values", () => {
    const r = validateBarcodes({
      upc: "036000291452",
      modelNumber: "  RV-99  ",
    });
    expect(r.isOk).toBe(true);
    if (r.isOk) {
      expect(r.value.upc?.value).toBe("036000291452");
      expect(r.value.modelNumber?.value).toBe("RV-99");
      expect(r.value.ean).toBeUndefined();
    }
  });

  it("rejects a malformed UPC even when the EAN is valid", () => {
    const r = validateBarcodes({ ean: "4006381333931", upc: "036000291451" });
    expect(r.isErr).toBe(true);
    if (r.isErr)
      expect(r.error.message).toBe("Invalid UPC: check digit does not match");
  });

  it("rejects a blank model number even when other identifiers are valid", () => {
    const r = validateBarcodes({ ean: "4006381333931", modelNumber: "   " });
    expect(r.isErr).toBe(true);
    if (r.isErr)
      expect(r.error.message).toBe("Invalid model number: must not be blank");
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
