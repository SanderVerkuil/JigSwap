import { describe, expect, it } from "vitest";
import {
  formatAvgReview,
  SEVERITY_HIGH,
  SEVERITY_MEDIUM,
  severityBand,
} from "./severity";

describe("severityBand", () => {
  it("exposes the band thresholds as constants", () => {
    expect(SEVERITY_HIGH).toBe(0.9);
    expect(SEVERITY_MEDIUM).toBe(0.7);
  });

  it("returns high at or above 0.9", () => {
    expect(severityBand(0.9)).toBe("high");
    expect(severityBand(1)).toBe("high");
  });

  it("returns medium from 0.7 up to (not including) 0.9", () => {
    expect(severityBand(0.89)).toBe("medium");
    expect(severityBand(0.7)).toBe("medium");
  });

  it("returns low below 0.7", () => {
    expect(severityBand(0.69)).toBe("low");
    expect(severityBand(0)).toBe("low");
  });

  it("treats a missing score as low", () => {
    expect(severityBand(null)).toBe("low");
    expect(severityBand(undefined)).toBe("low");
  });
});

describe("formatAvgReview", () => {
  it("renders an em dash when there is no sample", () => {
    expect(formatAvgReview(null)).toBe("—");
  });

  it("renders minutes under an hour", () => {
    expect(formatAvgReview(47)).toBe("47m");
  });

  it("renders whole hours without a minutes part", () => {
    expect(formatAvgReview(60)).toBe("1h");
  });

  it("renders hours and minutes", () => {
    expect(formatAvgReview(95)).toBe("1h 35m");
  });
});
