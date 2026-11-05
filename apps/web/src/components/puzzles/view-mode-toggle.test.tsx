// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ViewModeToggle, type ViewMode } from "./view-mode-toggle";

const renderToggle = (
  value: ViewMode,
  onChange: (mode: ViewMode) => void = () => {},
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <ViewModeToggle value={value} onChange={onChange} />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("ViewModeToggle", () => {
  it("is a labelled group of two named buttons with exactly one pressed", () => {
    renderToggle("list");
    const group = screen.getByRole("group", { name: "Layout" });
    expect(group).toBeTruthy();
    const grid = screen.getByRole("button", { name: "Grid view" });
    const list = screen.getByRole("button", { name: "List view" });
    expect(grid.getAttribute("aria-pressed")).toBe("false");
    expect(list.getAttribute("aria-pressed")).toBe("true");
  });

  it("reports the chosen mode", () => {
    const onChange = vi.fn();
    renderToggle("grid", onChange);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("names the buttons in Dutch", () => {
    renderToggle("grid", () => {}, "nl");
    expect(screen.getByRole("group", { name: "Weergave" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Rasterweergave" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Lijstweergave" })).toBeTruthy();
  });
});
