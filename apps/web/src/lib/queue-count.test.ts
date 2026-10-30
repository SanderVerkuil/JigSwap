import { describe, expect, it } from "vitest";
import { formatQueueCount, sumQueueCounts } from "./queue-count";

describe("formatQueueCount", () => {
  it("prints an exact count as is", () => {
    expect(formatQueueCount(0)).toBe("0");
    expect(formatQueueCount(7, false)).toBe("7");
  });

  it("marks a count that stopped at its cap with a plus", () => {
    expect(formatQueueCount(50, true)).toBe("50+");
    expect(formatQueueCount(104, true)).toBe("104+");
  });
});

describe("sumQueueCounts", () => {
  it("adds the counts and is capped when any part is", () => {
    expect(
      sumQueueCounts([
        { count: 2, capped: false },
        { count: 50, capped: true },
        { count: 0, capped: false },
      ]),
    ).toEqual({ count: 52, capped: true });
  });

  it("is exact when every part is", () => {
    expect(
      sumQueueCounts([
        { count: 2, capped: false },
        { count: 3, capped: false },
      ]),
    ).toEqual({ count: 5, capped: false });
    expect(sumQueueCounts([])).toEqual({ count: 0, capped: false });
  });
});
