import { describe, expect, it } from "vitest";
import { validateContactSearch } from "./contact-search";

describe("validateContactSearch", () => {
  it("keeps the Handled and All filters", () => {
    expect(validateContactSearch({ status: "handled" })).toEqual({
      status: "handled",
    });
    expect(validateContactSearch({ status: "all" })).toEqual({
      status: "all",
    });
  });

  it("leaves New, the default, out of the URL", () => {
    expect(validateContactSearch({ status: "new" })).toEqual({
      status: undefined,
    });
    expect(validateContactSearch({})).toEqual({ status: undefined });
  });

  it("drops an unknown or malformed status", () => {
    expect(validateContactSearch({ status: "archived" })).toEqual({
      status: undefined,
    });
    expect(validateContactSearch({ status: 1 })).toEqual({
      status: undefined,
    });
  });
});
