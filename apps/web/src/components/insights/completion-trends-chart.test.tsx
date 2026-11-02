// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  CompletionTrendsChart,
  type CompletionTrendPoint,
} from "./completion-trends-chart";

// "Completions / month" with its count/hours toggle: the title, the caption and the screen-reader
// table describe whichever metric is showing.

const DATA: CompletionTrendPoint[] = [
  { month: "2026-09", count: 0, totalMinutes: 0 },
  { month: "2026-10", count: 2, totalMinutes: 300 },
];

const renderChart = (data: CompletionTrendPoint[] = DATA) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="UTC">
      <CompletionTrendsChart data={data} />
    </IntlProvider>,
  );

const tableRows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .map((row) => row.textContent);

afterEach(cleanup);

describe("CompletionTrendsChart", () => {
  it("captions and tabulates the solves per month", () => {
    renderChart();
    expect(
      screen.getByRole("figure", {
        name: "Solves finished per month over the last 12 months.",
      }),
    ).toBeTruthy();
    expect(tableRows()).toEqual([
      "MonthCompletions",
      "September 20260",
      "October 20262",
    ]);
  });

  it("switches the caption and the table to hours with the toggle", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Solve hours" }));
    expect(
      screen.getByRole("figure", {
        name: "Solve time in hours per month over the last 12 months.",
      }),
    ).toBeTruthy();
    expect(tableRows()).toEqual([
      "MonthSolve hours",
      "September 20260",
      "October 20265",
    ]);
  });

  it("rounds hours to one decimal", () => {
    renderChart([{ month: "2026-10", count: 1, totalMinutes: 200 }]);
    fireEvent.click(screen.getByRole("button", { name: "Solve hours" }));
    expect(tableRows()).toEqual(["MonthSolve hours", "October 20263.3"]);
  });

  it("names the chart after the metric it shows", () => {
    renderChart();
    expect(
      screen.getByRole("heading", { level: 2, name: "Completions / month" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Solve hours" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Solve hours / month" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Completions" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Completions / month" }),
    ).toBeTruthy();
  });

  it("says no solve is dated in the window instead of drawing an empty chart, with no toggle", () => {
    // Also the state after importing only year-only and undated solves: those have no month.
    renderChart(DATA.map((d) => ({ ...d, count: 0, totalMinutes: 0 })));
    expect(screen.queryByRole("figure")).toBeNull();
    expect(
      screen.getByText("No dated solves in the last 12 months."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers no hours toggle while no solve has a typed time", () => {
    renderChart([{ month: "2026-10", count: 2, totalMinutes: 0 }]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(tableRows()).toEqual(["MonthCompletions", "October 20262"]);
  });
});
