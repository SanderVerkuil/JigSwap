// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  CollectionBreakdown,
  type CollectionBreakdownData,
} from "./collection-breakdown";

// The collection breakdown can be read without hovering and without telling colours apart: the
// difficulty chart is a stacked bar with a legend that names every difficulty in the app's
// language, with its count and share, and each difficulty keeps one colour whatever its count.

const breakdown = (
  over: Partial<CollectionBreakdownData> = {},
): CollectionBreakdownData => ({
  byPieceCount: [],
  byBrand: [],
  byDifficulty: [],
  byCondition: [],
  ...over,
});

const renderBreakdown = (
  data: CollectionBreakdownData,
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="UTC"
    >
      <CollectionBreakdown data={data} />
    </IntlProvider>,
  );

const legendRows = () =>
  within(screen.getByRole("list", { name: "By difficulty" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

const swatchOf = (container: HTMLElement, difficulty: string) =>
  container.querySelector(`[data-difficulty="${difficulty}"]`)?.className;

afterEach(cleanup);

describe("CollectionBreakdown: by difficulty", () => {
  it("lists every difficulty from easy to expert with its count and share", () => {
    renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "medium", value: 2 },
          { label: "expert", value: 1 },
          { label: "easy", value: 1 },
        ],
      }),
    );
    expect(legendRows()).toEqual(["Easy125%", "Medium250%", "Expert125%"]);
  });

  it("names the difficulties in Dutch in the Dutch app", () => {
    renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "hard", value: 3 },
          { label: "easy", value: 1 },
        ],
      }),
      "nl",
    );
    expect(
      within(screen.getByRole("list", { name: "Op moeilijkheid" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Gemakkelijk125%", "Moeilijk375%"]);
  });

  it("states the total the shares are of", () => {
    renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "medium", value: 2 },
          { label: "easy", value: 1 },
        ],
      }),
    );
    expect(screen.getByText("3 puzzles in total")).toBeTruthy();
  });

  it("keeps a difficulty's colour when the counts change the order", () => {
    const first = renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "easy", value: 5 },
          { label: "medium", value: 1 },
        ],
      }),
    );
    const easy = swatchOf(first.container, "easy");
    const medium = swatchOf(first.container, "medium");
    cleanup();
    const second = renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "medium", value: 5 },
          { label: "hard", value: 2 },
          { label: "easy", value: 1 },
        ],
      }),
    );
    expect(easy).toBeTruthy();
    expect(easy).not.toBe(medium);
    expect(swatchOf(second.container, "easy")).toBe(easy);
    expect(swatchOf(second.container, "medium")).toBe(medium);
  });

  it("draws the bar for sighted readers only; the legend carries the numbers", () => {
    const { container } = renderBreakdown(
      breakdown({ byDifficulty: [{ label: "easy", value: 1 }] }),
    );
    const bar = container.querySelector("[data-difficulty-bar]");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(bar?.querySelectorAll("[data-difficulty]")).toHaveLength(1);
  });

  it("shows a label it does not know as is, after the known difficulties", () => {
    // An older backend still sends the English word for copies without a difficulty.
    renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "Unknown", value: 2 },
          { label: "easy", value: 2 },
        ],
      }),
    );
    expect(legendRows()).toEqual(["Easy250%", "Unknown250%"]);
  });
});
