import { createFormatter } from "use-intl";
import { describe, expect, it } from "vitest";
import { monthLabel } from "./sparkbars";

// The app pins a time zone east of UTC; the bucket must still read as its own month.
const fmt = (locale: string) =>
  createFormatter({ locale, timeZone: "Europe/Amsterdam" });

describe("monthLabel", () => {
  // The label follows the app locale, never the server's or browser's (UX-63).
  it("names the bucket's month in the app locale", () => {
    expect(monthLabel(fmt("en"), "2025-03")).toBe("Mar");
    expect(monthLabel(fmt("nl"), "2025-03")).toBe("mrt");
  });

  it("keeps the bucket's own month at the year boundary", () => {
    expect(monthLabel(fmt("en"), "2025-01")).toBe("Jan");
    expect(monthLabel(fmt("en"), "2024-12")).toBe("Dec");
  });
});
