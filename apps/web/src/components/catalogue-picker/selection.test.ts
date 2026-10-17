import { describe, expect, it } from "vitest";
import {
  buildPickerRows,
  PICK_LIMIT,
  registerSearch,
  removeLastPick,
  removePick,
  setPickForTrade,
  toAcquireItems,
  togglePick,
  type Pick,
} from "./selection";

const pick = (definitionId: string, forTrade = false): Pick => ({
  definitionId,
  title: `Title ${definitionId}`,
  pending: false,
  forTrade,
});

describe("togglePick", () => {
  it("adds an unpicked row at the end with forTrade off", () => {
    const picks = togglePick([pick("a")], {
      definitionId: "b",
      title: "Title b",
      pending: true,
    });
    expect(picks).toEqual([
      pick("a"),
      { definitionId: "b", title: "Title b", pending: true, forTrade: false },
    ]);
  });

  it("removes a picked row", () => {
    expect(togglePick([pick("a"), pick("b")], pick("a"))).toEqual([pick("b")]);
  });

  it("does not add past the limit, but still removes at the limit", () => {
    const full = Array.from({ length: PICK_LIMIT }, (_, i) => pick(`p${i}`));
    expect(PICK_LIMIT).toBe(25);
    expect(togglePick(full, pick("extra"))).toBe(full);
    expect(togglePick(full, pick("p3"))).toHaveLength(PICK_LIMIT - 1);
  });
});

describe("removePick / removeLastPick", () => {
  it("removes by id and leaves the rest in order", () => {
    expect(removePick([pick("a"), pick("b"), pick("c")], "b")).toEqual([
      pick("a"),
      pick("c"),
    ]);
  });

  it("removes the most recent pick, and is a no-op on an empty tray", () => {
    expect(removeLastPick([pick("a"), pick("b")])).toEqual([pick("a")]);
    expect(removeLastPick([])).toEqual([]);
  });
});

describe("setPickForTrade", () => {
  it("flips only the named pick", () => {
    expect(setPickForTrade([pick("a"), pick("b")], "b", true)).toEqual([
      pick("a"),
      pick("b", true),
    ]);
  });
});

describe("toAcquireItems", () => {
  it("maps picks to the acquireCopies items, keeping each forTrade", () => {
    expect(toAcquireItems([pick("a"), pick("b", true)])).toEqual([
      { puzzleDefinitionId: "a", forTrade: false },
      { puzzleDefinitionId: "b", forTrade: true },
    ]);
  });
});

describe("buildPickerRows", () => {
  const result = (aggregateId: string | undefined, title: string) => ({
    aggregateId,
    title,
    brand: "Ravensburger",
    pieceCount: 1000,
    image: null,
  });

  it("lists matching own submissions first, then search results, marking shelf copies", () => {
    const rows = buildPickerRows({
      term: "cove",
      results: [result("a1", "Mountain Cove"), result("a2", "Cove Lights")],
      mySubmissions: [
        result("mine", "Hidden Cove"),
        result("other", "Northern Lights"),
      ],
      ownedDefinitionIds: new Set(["a2"]),
    });
    expect(rows.map((r) => [r.definitionId, r.pending, r.onShelf])).toEqual([
      ["mine", true, false],
      ["a1", false, false],
      ["a2", false, true],
    ]);
  });

  it("matches own submissions on brand too, case-insensitively", () => {
    const rows = buildPickerRows({
      term: "RAVENS",
      results: [],
      mySubmissions: [result("mine", "Hidden Cove")],
      ownedDefinitionIds: new Set(),
    });
    expect(rows.map((r) => r.definitionId)).toEqual(["mine"]);
  });

  it("drops rows without an aggregate id and duplicates of an own submission", () => {
    const rows = buildPickerRows({
      term: "cove",
      results: [
        result(undefined, "Legacy Cove"),
        result("mine", "Hidden Cove"),
      ],
      mySubmissions: [result("mine", "Hidden Cove")],
      ownedDefinitionIds: new Set(),
    });
    expect(rows.map((r) => r.definitionId)).toEqual(["mine"]);
  });

  it("shows only the own submissions for a blank term", () => {
    const rows = buildPickerRows({
      term: "  ",
      results: [result("a1", "Mountain Cove")],
      mySubmissions: [result("mine", "Hidden Cove")],
      ownedDefinitionIds: new Set(["mine"]),
    });
    expect(rows.map((r) => [r.definitionId, r.pending, r.onShelf])).toEqual([
      ["mine", true, true],
    ]);
  });
});

describe("registerSearch", () => {
  it("prefills the trimmed query and carries returnTo", () => {
    expect(registerSearch(" Cats at night ", "/welcome?step=puzzles")).toEqual({
      title: "Cats at night",
      returnTo: "/welcome?step=puzzles",
    });
  });

  it("leaves out an empty query and a missing returnTo", () => {
    expect(registerSearch("  ", undefined)).toEqual({
      title: undefined,
      returnTo: undefined,
    });
  });
});
