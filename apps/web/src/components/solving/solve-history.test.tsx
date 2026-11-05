// @vitest-environment happy-dom
import type { HistoryRow } from "@/lib/completion-history";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { SolveHistory } from "./solve-history";

// The completion log's History: a heading per year with its number of solves, undated solves
// last, and 30 rows at a time behind Show more.

type Row = HistoryRow & { id: string };

const solvedOn = (id: string, y: number, m: number, d: number): Row => ({
  id,
  startDate: Date.UTC(y, m, d),
  endDate: Date.UTC(y, m, d),
});
const undated = (id: string): Row => ({
  id,
  startDate: Date.UTC(2026, 9, 30),
  endDate: Date.UTC(2026, 9, 30),
  datePrecision: "unknown",
});

const renderHistory = (rows: Row[], locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <SolveHistory
        rows={rows}
        renderRow={(row) => (
          <div key={row.id} data-testid="row">
            {row.id}
          </div>
        )}
      />
    </IntlProvider>,
  );

const yearHeadings = () =>
  screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const shownRows = () =>
  screen.queryAllByTestId("row").map((row) => row.textContent);

afterEach(cleanup);

describe("SolveHistory", () => {
  it("puts the solves under a History heading and one heading per year", () => {
    renderHistory([
      solvedOn("a", 2026, 4, 1),
      solvedOn("b", 2025, 1, 1),
      solvedOn("c", 2026, 8, 1),
      undated("u"),
    ]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "History",
    );
    expect(yearHeadings()).toEqual([
      "20262 solves",
      "20251 solve",
      "Date unknown1 solve",
    ]);
    expect(shownRows()).toEqual(["c", "a", "b", "u"]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows 30 solves, then the rest after Show more", () => {
    const rows = Array.from({ length: 32 }, (_, i) =>
      solvedOn(`r${i}`, 2026, 0, i + 1),
    );
    renderHistory(rows);
    expect(shownRows()).toHaveLength(30);
    // The year heading counts every solve, also the ones not shown yet.
    expect(yearHeadings()).toEqual(["202632 solves"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(shownRows()).toHaveLength(32);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing without finished solves", () => {
    const { container } = renderHistory([]);
    expect(container.textContent).toBe("");
  });

  it("speaks Dutch", () => {
    const rows = [
      ...Array.from({ length: 31 }, (_, i) => solvedOn(`r${i}`, 2026, 0, 1)),
      undated("u"),
    ];
    renderHistory(rows, "nl");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Geschiedenis",
    );
    expect(yearHeadings()).toEqual(["202631 voltooiingen"]);
    expect(screen.getByRole("button", { name: "Nog 2 tonen" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Nog 2 tonen" }));
    expect(yearHeadings()).toEqual([
      "202631 voltooiingen",
      "Datum onbekend1 voltooiing",
    ]);
  });
});
