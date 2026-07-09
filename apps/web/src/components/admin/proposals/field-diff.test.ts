import { describe, expect, it } from "vitest";
import { fieldDiffRows } from "./field-diff";

describe("fieldDiffRows", () => {
  it("emits one row per defined change, pairing proposed with current/baseline and conflict flag", () => {
    const rows = fieldDiffRows({
      changes: { title: "New", pieceCount: 500, brand: undefined },
      baseline: { title: "Old", pieceCount: 1000 },
      current: { title: "Renamed Meanwhile", pieceCount: 1000 },
      conflictFields: ["title"],
    });
    expect(rows).toEqual([
      {
        key: "title",
        proposed: "New",
        current: "Renamed Meanwhile",
        baseline: "Old",
        conflict: true,
      },
      {
        key: "pieceCount",
        proposed: 500,
        current: 1000,
        baseline: 1000,
        conflict: false,
      },
    ]);
  });

  it("keeps grouped/object values intact (barcodes, dimensions, tags)", () => {
    const rows = fieldDiffRows({
      changes: {
        barcodes: { ean: "4006381333931" },
        tags: ["a", "b"],
        dimensions: { width: 70, height: 50, unit: "cm" },
      },
      baseline: { barcodes: {}, tags: [], dimensions: undefined },
      current: { barcodes: {}, tags: [], dimensions: undefined },
      conflictFields: [],
    });
    expect(rows.map((r) => r.key)).toEqual(["barcodes", "tags", "dimensions"]);
    expect(rows[0].proposed).toEqual({ ean: "4006381333931" });
    expect(rows[2].current).toBeUndefined();
  });

  it("returns [] for an empty diff", () => {
    expect(
      fieldDiffRows({
        changes: {},
        baseline: {},
        current: {},
        conflictFields: [],
      }),
    ).toEqual([]);
  });
});
