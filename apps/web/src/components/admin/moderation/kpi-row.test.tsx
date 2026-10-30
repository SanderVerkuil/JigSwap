// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { KpiRow } from "./kpi-row";

vi.mock("@/gateway", () => ({ gateway: { admin: {} } }));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({
    data: { approved: 4, rejected: 1, flagsCleared: 7, avgReviewMins: 30 },
  }),
}));

afterEach(cleanup);

const renderRow = (locale: "en" | "nl") =>
  render(
    <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
      <KpiRow />
    </IntlProvider>,
  );

describe("KpiRow", () => {
  it("names the period once above the tiles, not after every label (en/nl)", () => {
    renderRow("en");
    const region = screen.getByRole("region", { name: "Last 7 days" });
    expect(region.textContent?.match(/7 days|this week/gi)).toHaveLength(1);

    cleanup();
    renderRow("nl");
    expect(
      screen.getByRole("region", { name: "Afgelopen 7 dagen" }),
    ).toBeTruthy();
  });

  it("lets a long label wrap to two lines and keeps the full text as a title", () => {
    renderRow("nl");
    const label = screen.getByText("Markeringen afgehandeld");
    expect(label.className).toContain("line-clamp-2");
    expect(label.className).not.toContain("truncate");
    expect(label.getAttribute("title")).toBe("Markeringen afgehandeld");
  });
});
