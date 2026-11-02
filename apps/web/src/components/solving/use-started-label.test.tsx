// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { useStartedLabel } from "./use-started-label";

const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {children}
  </IntlProvider>
);

// A start is a calendar date stored as UTC midnight (lib/date-input), not an instant.
const startedOn = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day);

describe("useStartedLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const labelFor = (start: number) =>
    renderHook(() => useStartedLabel(), { wrapper }).result.current(start);

  it("counts calendar days, so a date-only start is never off by hours", () => {
    // Late evening: a relative time from UTC midnight would read "22 hours ago".
    vi.setSystemTime(new Date(2026, 10, 2, 23, 30));
    expect(labelFor(startedOn(2026, 11, 2))).toBe("Started today");
    expect(labelFor(startedOn(2026, 11, 1))).toBe("Started 1 day ago");
    expect(labelFor(startedOn(2026, 10, 28))).toBe("Started 5 days ago");
  });

  it("says a date still ahead of the member's calendar starts later", () => {
    vi.setSystemTime(new Date(2026, 10, 2, 12));
    expect(labelFor(startedOn(2026, 11, 3))).toBe("Starts in 1 day");
  });
});
