// @vitest-environment happy-dom
import { Tabs } from "@/components/ui/tabs";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { ModerationTabBar, type ModerationTabEntry } from "./moderation-tabs";

// Every tab and its count stays in view: a count that scrolled out of sight is a queue nobody
// works. From md the tabs wrap instead of scrolling; below md, where seven don't fit two rows,
// they are one dropdown that lists them all with their counts.

const TABS: ModerationTabEntry[] = [
  { value: "submissions", label: "Submissions", count: 2 },
  { value: "flagged", label: "Flagged", count: 50, capped: true },
  { value: "appeals", label: "Review Requests", count: 3 },
  { value: "activity", label: "Activity Log" },
];

const renderBar = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Tabs value="appeals">
        <ModerationTabBar tabs={TABS} value="appeals" onValueChange={vi.fn()} />
      </Tabs>
    </IntlProvider>,
  );

afterEach(cleanup);

describe("ModerationTabBar", () => {
  it("draws the tabs with their counts, no icons, wrapping from md and hidden below it", () => {
    renderBar();
    const tabs = screen.getAllByRole("tab", { hidden: true });
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Submissions2",
      "Flagged50+",
      "Review Requests3",
      "Activity Log",
    ]);
    expect(tabs[0]?.querySelector("svg")).toBeNull();
    const list = screen.getByRole("tablist", { hidden: true });
    expect(list.className).toContain("max-md:hidden");
    expect(list.className).toContain("md:flex-wrap");
    expect(list.className).toContain("md:overflow-visible");
  });

  it("offers the same tabs as a named dropdown below md, showing the open one", () => {
    renderBar();
    const select = screen.getByRole("combobox", { name: "Moderation queue" });
    expect(select.parentElement?.className).toContain("md:hidden");
    expect(select.textContent).toContain("Review Requests");
    expect(select.textContent).toContain("3");
  });

  it("publishes the bar's height for what sticks below it", () => {
    let resize: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = renderBar();
    const root = container.firstElementChild as HTMLElement;
    const bar = root.firstElementChild as HTMLElement;
    Object.defineProperty(bar, "offsetHeight", { value: 88 });
    resize();
    expect(root.style.getPropertyValue("--moderation-tabs-height")).toBe(
      "88px",
    );
    vi.unstubAllGlobals();
  });
});
