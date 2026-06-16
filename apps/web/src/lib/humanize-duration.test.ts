import { describe, expect, it } from "vitest";
import { durationParts } from "./humanize-duration";

describe("durationParts", () => {
  it("keeps sub-hour durations in minutes (the old code rounded these to 0 days)", () => {
    expect(durationParts(30)).toEqual({ value: 30, unit: "minute" });
  });

  it("never returns 0 — a near-zero duration floors to 1 minute", () => {
    expect(durationParts(0)).toEqual({ value: 1, unit: "minute" });
  });

  it("shows hours for a 1-hour solve (the reported bug: was '0 days')", () => {
    expect(durationParts(60)).toEqual({ value: 1, unit: "hour" });
    expect(durationParts(120)).toEqual({ value: 2, unit: "hour" });
  });

  it("shows days between 1 day and 1 week", () => {
    expect(durationParts(60 * 24)).toEqual({ value: 1, unit: "day" });
    expect(durationParts(60 * 24 * 4)).toEqual({ value: 4, unit: "day" });
  });

  it("shows weeks between 1 week and ~1 month", () => {
    expect(durationParts(60 * 24 * 7)).toEqual({ value: 1, unit: "week" });
  });

  it("caps at months for long durations", () => {
    expect(durationParts(60 * 24 * 30)).toEqual({ value: 1, unit: "month" });
    expect(durationParts(60 * 24 * 90)).toEqual({ value: 3, unit: "month" });
  });
});
