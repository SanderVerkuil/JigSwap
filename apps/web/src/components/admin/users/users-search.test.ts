import { describe, expect, it } from "vitest";
import { looksLikeEmail, validateAdminUsersSearch } from "./users-search";

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

describe("looksLikeEmail", () => {
  it("is true for a whole address, which the server looks up exactly", () => {
    expect(looksLikeEmail("mara@example.com")).toBe(true);
    expect(looksLikeEmail("mara@example")).toBe(true);
  });

  it("is false for names, usernames and half addresses", () => {
    expect(looksLikeEmail("mara")).toBe(false);
    expect(looksLikeEmail("@mara")).toBe(false);
    expect(looksLikeEmail("mara@")).toBe(false);
    expect(looksLikeEmail("mara @example.com")).toBe(false);
  });
});
