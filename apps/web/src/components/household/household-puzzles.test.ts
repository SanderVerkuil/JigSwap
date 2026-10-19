import { describe, expect, it } from "vitest";
import { filterHouseholdPuzzles } from "./household-puzzles";

const copy = (
  id: string,
  ownerId: string,
  availability: Partial<{
    forTrade: boolean;
    forLend: boolean;
    forSale: boolean;
  }> = {},
) => ({
  id,
  ownerId,
  availability: {
    forTrade: false,
    forLend: false,
    forSale: false,
    ...availability,
  },
});

const copies = [
  copy("mine-trade", "u_me", { forTrade: true }),
  copy("mine-shelf", "u_me"),
  copy("ann-lend", "u_ann", { forLend: true }),
  copy("ann-sale", "u_ann", { forSale: true }),
  copy("bob-shelf", "u_bob"),
];
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe("filterHouseholdPuzzles", () => {
  it("shows every puzzle in the household by default", () => {
    expect(ids(filterHouseholdPuzzles(copies, "all", "all"))).toHaveLength(5);
  });

  it("narrows to one owner", () => {
    expect(ids(filterHouseholdPuzzles(copies, "u_me", "all"))).toEqual([
      "mine-trade",
      "mine-shelf",
    ]);
    expect(ids(filterHouseholdPuzzles(copies, "u_ann", "all"))).toEqual([
      "ann-lend",
      "ann-sale",
    ]);
  });

  it("narrows by availability, combined with the owner", () => {
    expect(ids(filterHouseholdPuzzles(copies, "all", "available"))).toEqual([
      "mine-trade",
      "ann-lend",
      "ann-sale",
    ]);
    expect(ids(filterHouseholdPuzzles(copies, "all", "forTrade"))).toEqual([
      "mine-trade",
    ]);
    expect(ids(filterHouseholdPuzzles(copies, "u_ann", "forLend"))).toEqual([
      "ann-lend",
    ]);
    expect(filterHouseholdPuzzles(copies, "u_bob", "available")).toEqual([]);
  });
});
