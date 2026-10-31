import { describe, expect, it } from "vitest";
import { validateAdminPuzzlesSearch } from "./puzzles-search";

describe("validateAdminPuzzlesSearch", () => {
  it("keeps a known status and a trimmed search term", () => {
    expect(
      validateAdminPuzzlesSearch({ status: "pending", q: "  starry " }),
    ).toEqual({ status: "pending", q: "starry" });
    for (const status of ["approved", "rejected", "disabled"]) {
      expect(validateAdminPuzzlesSearch({ status }).status).toBe(status);
    }
  });

  it("drops an unknown status and a blank or non-string term", () => {
    expect(
      validateAdminPuzzlesSearch({ status: "archived", q: "   " }),
    ).toEqual({ status: undefined, q: undefined });
    expect(validateAdminPuzzlesSearch({ status: 1, q: 42 })).toEqual({
      status: undefined,
      q: undefined,
    });
    expect(validateAdminPuzzlesSearch({})).toEqual({
      status: undefined,
      q: undefined,
    });
  });
});
