// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { Sparkbars, type SparkbarPoint } from "./sparkbars";

// The monthly insight charts can be read without hovering: a named figure with a visible caption,
// the value written above every month that has one, empty months drawn as a baseline instead of a
// bar, and a screen-reader table with the same numbers.

const POINTS: SparkbarPoint[] = [
  { month: "2025-11", value: 0 },
  { month: "2025-12", value: 3 },
  { month: "2026-01", value: 0 },
  { month: "2026-10", value: 1250 },
];

const renderBars = (
  locale: "en" | "nl" = "en",
  points: SparkbarPoint[] = POINTS,
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      // West of UTC, a month's first instant (UTC midnight) is still the previous month locally.
      timeZone="America/Los_Angeles"
    >
      <Sparkbars
        points={points}
        caption="Solves finished per month over the last 12 months."
        valueLabel="Completions"
      />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("Sparkbars", () => {
  it("is a figure named by its visible caption", () => {
    renderBars();
    const figure = screen.getByRole("figure", {
      name: "Solves finished per month over the last 12 months.",
    });
    expect(
      within(figure).getByText(
        "Solves finished per month over the last 12 months.",
      ),
    ).toBeTruthy();
  });

  it("gives screen readers a table with one row per month, months in UTC", () => {
    renderBars();
    const table = screen.getByRole("table", {
      name: "Solves finished per month over the last 12 months.",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(POINTS.length + 1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "MonthCompletions",
      "November 20250",
      "December 20253",
      "January 20260",
      "October 20261,250",
    ]);
  });

  it("hides the drawn bars from screen readers, which read the table instead", () => {
    const { container } = renderBars();
    const drawing = container.querySelector("[aria-hidden='true']");
    expect(drawing).not.toBeNull();
    expect(drawing?.querySelectorAll("[data-bar]")).toHaveLength(2);
  });

  it("draws an empty month as a baseline, not as a bar", () => {
    const { container } = renderBars();
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-baseline]")).toHaveLength(2);
    const columns = [...container.querySelectorAll("[data-month]")];
    expect(columns.map((c) => c.getAttribute("data-month"))).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-10",
    ]);
    expect(columns.map((c) => c.querySelector("[data-bar]") !== null)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("writes the value above every month that has one, and only those", () => {
    const { container } = renderBars();
    const values = [...container.querySelectorAll("[data-value]")].map(
      (v) => v.textContent,
    );
    expect(values).toEqual(["3", "1.3K"]);
  });

  it("labels every month with its short name, read in UTC", () => {
    const { container } = renderBars();
    const labels = [...container.querySelectorAll("[data-month-label]")].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(["Nov", "Dec", "Jan", "Oct"]);
  });

  it("speaks Dutch in the Dutch app", () => {
    const { container } = renderBars("nl");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[0]?.textContent).toBe("MaandCompletions");
    expect(rows[4]?.textContent).toBe("oktober 20261.250");
    const values = [...container.querySelectorAll("[data-value]")].map(
      (v) => v.textContent,
    );
    expect(values).toEqual(["3", "1,3K"]);
  });

  it("draws no bars at all when every month is empty", () => {
    const { container } = renderBars("en", [
      { month: "2026-09", value: 0 },
      { month: "2026-10", value: 0 },
    ]);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-value]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-baseline]")).toHaveLength(2);
  });
});
