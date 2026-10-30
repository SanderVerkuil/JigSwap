import { describe, expect, it } from "vitest";
import { validateModerationSearch } from "./moderation-search";

const EMPTY = {
  tab: undefined,
  item: undefined,
  report: undefined,
  status: undefined,
  kind: undefined,
  actor: undefined,
};

describe("validateModerationSearch", () => {
  it("keeps a known tab, an item, a report and a report status", () => {
    expect(
      validateModerationSearch({
        tab: "reports",
        item: "k57abc",
        report: "r123",
        status: "dismissed",
      }),
    ).toEqual({
      tab: "reports",
      item: "k57abc",
      report: "r123",
      status: "dismissed",
    });
  });

  it("accepts every console tab", () => {
    for (const tab of [
      "submissions",
      "flagged",
      "unchecked",
      "appeals",
      "hashMatches",
      "reports",
      "activity",
    ]) {
      expect(validateModerationSearch({ tab }).tab).toBe(tab);
    }
  });

  it("drops an unknown tab or report status", () => {
    expect(
      validateModerationSearch({ tab: "bogus", status: "closed" }),
    ).toEqual(EMPTY);
  });

  it("drops empty, whitespace-only and non-string values", () => {
    expect(
      validateModerationSearch({ tab: 3, item: "  ", report: 42, status: [] }),
    ).toEqual(EMPTY);
  });

  it("trims the ids", () => {
    expect(validateModerationSearch({ item: " abc ", report: " r1 " })).toEqual(
      { ...EMPTY, item: "abc", report: "r1" },
    );
  });

  it("keeps the activity log's kind and actor filters", () => {
    expect(
      validateModerationSearch({
        tab: "activity",
        kind: "report_warned",
        actor: " j57actor ",
      }),
    ).toEqual({
      ...EMPTY,
      tab: "activity",
      kind: "report_warned",
      actor: "j57actor",
    });
    expect(validateModerationSearch({ kind: "", actor: 7 })).toEqual(EMPTY);
  });

  it("ignores unrelated params", () => {
    expect(validateModerationSearch({ other: "x" })).toEqual(EMPTY);
  });
});
