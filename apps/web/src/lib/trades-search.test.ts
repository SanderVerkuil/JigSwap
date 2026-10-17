import { describe, expect, it } from "vitest";
import { validateTradesSearch } from "./trades-search";

describe("/trades search params", () => {
  it("keeps a notification's ?exchange=<id> deep link", () => {
    expect(validateTradesSearch({ exchange: "ex_123" })).toEqual({
      exchange: "ex_123",
    });
  });

  it("drops a missing, blank or non-string exchange", () => {
    expect(validateTradesSearch({})).toEqual({ exchange: undefined });
    expect(validateTradesSearch({ exchange: "  " })).toEqual({
      exchange: undefined,
    });
    expect(validateTradesSearch({ exchange: 42 })).toEqual({
      exchange: undefined,
    });
  });
});
