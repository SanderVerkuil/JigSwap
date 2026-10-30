// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  TradeActivityChart,
  type TradeActivityData,
} from "./trade-activity-chart";

// "Swaps / month": the caption says what the bars count and the table carries every month,
// quiet ones included.

const DATA: TradeActivityData = {
  total: 3,
  byStatus: [
    { status: "proposed", count: 1 },
    { status: "completed", count: 2 },
  ],
  byMonth: [
    { month: "2026-08", count: 2 },
    { month: "2026-09", count: 0 },
    { month: "2026-10", count: 1 },
  ],
};

const renderChart = (data: TradeActivityData = DATA) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="UTC">
      <TradeActivityChart data={data} />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("TradeActivityChart", () => {
  it("captions the chart and tabulates every month, quiet ones included", () => {
    renderChart();
    const figure = screen.getByRole("figure", {
      name: "Swaps started per month over the last 12 months.",
    });
    const rows = within(figure)
      .getAllByRole("row")
      .map((row) => row.textContent);
    expect(rows).toEqual([
      "MonthExchanges",
      "August 20262",
      "September 20260",
      "October 20261",
    ]);
    expect(screen.getByText("1 Proposed · 2 Completed")).toBeTruthy();
  });

  it("says there are no exchanges yet instead of drawing an empty chart", () => {
    renderChart({ total: 0, byStatus: [], byMonth: DATA.byMonth });
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText("No exchanges yet.")).toBeTruthy();
  });
});
