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

  it("keeps the tab and the status filter so the view survives back/forward", () => {
    expect(
      validateTradesSearch({ tab: "incoming", status: "completed" }),
    ).toEqual({ tab: "incoming", status: "completed" });
    expect(validateTradesSearch({ tab: "outgoing" })).toEqual({
      tab: "outgoing",
    });
    expect(validateTradesSearch({ status: "proposed" })).toEqual({
      status: "proposed",
    });
  });

  it("treats All as the default, without a param", () => {
    expect(validateTradesSearch({ tab: "all" }).tab).toBeUndefined();
  });

  it("drops an unknown tab or status", () => {
    const search = validateTradesSearch({ tab: "completed", status: "lost" });
    expect(search.tab).toBeUndefined();
    expect(search.status).toBeUndefined();
    const garbled = validateTradesSearch({ tab: 3, status: ["accepted"] });
    expect(garbled.tab).toBeUndefined();
    expect(garbled.status).toBeUndefined();
  });

  it("has no status filter on the Loans tab", () => {
    expect(validateTradesSearch({ tab: "loans", status: "accepted" })).toEqual({
      tab: "loans",
    });
  });

  it("opens Loans for the old Borrowed tab", () => {
    expect(validateTradesSearch({ tab: "borrowed" })).toEqual({
      tab: "loans",
    });
  });

  // The router merges the raw query with the validator's result, so a key left out of the result
  // would pass through unvalidated: every key must be present, undefined when dropped.
  it("returns every key, so a dropped param can't slip through unvalidated", () => {
    for (const search of [
      {},
      { exchange: "ex_123", tab: "incoming", status: "rejected" },
      { tab: "loans", status: "accepted" },
    ]) {
      expect(Object.keys(validateTradesSearch(search)).sort()).toEqual([
        "exchange",
        "status",
        "tab",
      ]);
    }
  });

  it("shows every exchange for a deep link, so the linked row is never filtered out", () => {
    expect(
      validateTradesSearch({
        exchange: "ex_123",
        tab: "incoming",
        status: "cancelled",
      }),
    ).toEqual({ exchange: "ex_123" });
  });
});
