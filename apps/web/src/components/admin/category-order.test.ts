import { describe, expect, it } from "vitest";
import { moveCategoryOrder } from "./category-order";

const rows = (...ids: (string | undefined)[]) =>
  ids.map((aggregateId) => ({ aggregateId }));

describe("moveCategoryOrder", () => {
  it("renumbers the whole list in its new order", () => {
    expect(moveCategoryOrder(rows("a", "b", "c"), 2, 0)).toEqual([
      { catalogCategoryId: "c", sortOrder: 0 },
      { catalogCategoryId: "a", sortOrder: 1 },
      { catalogCategoryId: "b", sortOrder: 2 },
    ]);
  });

  it("moves one step up or down (the Move up / Move down menu)", () => {
    expect(moveCategoryOrder(rows("a", "b", "c"), 1, 0)).toEqual([
      { catalogCategoryId: "b", sortOrder: 0 },
      { catalogCategoryId: "a", sortOrder: 1 },
      { catalogCategoryId: "c", sortOrder: 2 },
    ]);
    expect(moveCategoryOrder(rows("a", "b", "c"), 1, 2)).toEqual([
      { catalogCategoryId: "a", sortOrder: 0 },
      { catalogCategoryId: "c", sortOrder: 1 },
      { catalogCategoryId: "b", sortOrder: 2 },
    ]);
  });

  it("skips legacy rows without an aggregateId but keeps their slot", () => {
    expect(moveCategoryOrder(rows("a", undefined, "c"), 2, 1)).toEqual([
      { catalogCategoryId: "a", sortOrder: 0 },
      { catalogCategoryId: "c", sortOrder: 1 },
    ]);
  });

  it("returns null when nothing would move", () => {
    expect(moveCategoryOrder(rows("a", "b"), 1, 1)).toBeNull();
    expect(moveCategoryOrder(rows("a", "b"), 0, -1)).toBeNull();
    expect(moveCategoryOrder(rows("a", "b"), 1, 2)).toBeNull();
    expect(moveCategoryOrder(rows("a", "b"), -1, 0)).toBeNull();
  });
});
