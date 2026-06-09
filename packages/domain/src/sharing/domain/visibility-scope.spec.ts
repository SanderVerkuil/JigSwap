import { describe, expect, it } from "vitest";
import {
  isPubliclyViewable,
  permitsTransaction,
  TransactionKind,
  VisibilityScope,
} from "./visibility-scope";

describe("isPubliclyViewable", () => {
  it.each<[VisibilityScope, boolean]>([
    ["private", false],
    ["friendCircle", false],
    ["visible", true],
    ["lendable", true],
    ["swappable", true],
    ["tradeable", true],
  ])("%s -> %s", (scope, expected) => {
    expect(isPubliclyViewable(scope)).toBe(expected);
  });
});

describe("permitsTransaction", () => {
  const KINDS: TransactionKind[] = ["lend", "swap", "trade"];

  it.each<[VisibilityScope, TransactionKind]>([
    ["lendable", "lend"],
    ["swappable", "swap"],
    ["tradeable", "trade"],
  ])("%s permits exactly %s", (scope, allowed) => {
    expect(permitsTransaction(scope, allowed)).toBe(true);
    for (const other of KINDS.filter((k) => k !== allowed)) {
      expect(permitsTransaction(scope, other)).toBe(false);
    }
  });

  it.each<VisibilityScope>(["private", "friendCircle", "visible"])(
    "%s permits no transaction",
    (scope) => {
      for (const kind of KINDS) expect(permitsTransaction(scope, kind)).toBe(false);
    },
  );
});
