import { describe, expect, it } from "vitest";
import {
  filterByPermission,
  selectAll,
  selectedVisibleIds,
  toggleSelected,
} from "./bulk-permission";

const copies = [
  { _id: "a", householdPermission: "manage" as const },
  { _id: "b", householdPermission: "view" as const },
  { _id: "c", householdPermission: "manage" as const },
];

describe("filterByPermission", () => {
  it("keeps everything for 'all' and only the matching permission otherwise", () => {
    expect(filterByPermission(copies, "all")).toEqual(copies);
    expect(filterByPermission(copies, "manage").map((c) => c._id)).toEqual([
      "a",
      "c",
    ]);
    expect(filterByPermission(copies, "view").map((c) => c._id)).toEqual(["b"]);
  });
});

describe("toggleSelected", () => {
  it("adds an unselected id and removes a selected one without mutating", () => {
    const start = new Set(["a"]);
    expect([...toggleSelected(start, "b")]).toEqual(["a", "b"]);
    expect([...toggleSelected(start, "a")]).toEqual([]);
    expect([...start]).toEqual(["a"]);
  });
});

describe("selectAll", () => {
  it("selects exactly the visible copies", () => {
    expect([...selectAll(filterByPermission(copies, "manage"))]).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("selectedVisibleIds", () => {
  it("acts only on selected copies that are currently visible, in list order", () => {
    const selected = new Set(["c", "b", "gone"]);
    expect(selectedVisibleIds(selected, copies)).toEqual(["b", "c"]);
    // Changing the filter hides "b", so it is no longer part of the action.
    expect(
      selectedVisibleIds(selected, filterByPermission(copies, "manage")),
    ).toEqual(["c"]);
  });
});
