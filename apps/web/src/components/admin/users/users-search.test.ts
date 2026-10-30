import { describe, expect, it } from "vitest";
import { validateAdminUsersSearch } from "./users-search";

describe("validateAdminUsersSearch", () => {
  it("keeps a trimmed search term", () => {
    expect(validateAdminUsersSearch({ q: "  marieke " })).toEqual({
      q: "marieke",
    });
  });

  it("drops a missing, blank or non-string term", () => {
    expect(validateAdminUsersSearch({})).toEqual({ q: undefined });
    expect(validateAdminUsersSearch({ q: "   " })).toEqual({ q: undefined });
    expect(validateAdminUsersSearch({ q: 42 })).toEqual({ q: undefined });
  });
});
