// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  brandSeries,
  bucketLabel,
  CollectionBreakdown,
  OTHER_BUCKET,
  pieceCountLabel,
  UNKNOWN_BUCKET,
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

describe("pieceCountLabel", () => {
  const names = { unknown: "Onbekend", other: "Overig" };
  const dutch = (n: number) => new Intl.NumberFormat("nl").format(n);
  const english = (n: number) => new Intl.NumberFormat("en").format(n);

  // The rest of the app shows 1.000 in Dutch and 1,000 in English.
  it.each([
    ["< 100", "< 100", "< 100"],
    ["100-299", "100–299", "100–299"],
    ["500-999", "500–999", "500–999"],
    ["1000-1999", "1.000–1.999", "1,000–1,999"],
    ["2000+", "2.000+", "2,000+"],
  ])("formats %s", (bucket, inDutch, inEnglish) => {
    expect(pieceCountLabel(bucket, names, dutch)).toBe(inDutch);
    expect(pieceCountLabel(bucket, names, english)).toBe(inEnglish);
  });

  it("translates the sentinel, and leaves anything it doesn't recognise as it is", () => {
    expect(pieceCountLabel(UNKNOWN_BUCKET, names, dutch)).toBe("Onbekend");
    expect(pieceCountLabel("Unknown", names, dutch)).toBe("Unknown");
  });
});

describe("CollectionBreakdown: columns", () => {
  // Three columns next to an open sidebar leave a chart 209px at 1024 wide, most of it labels.
  it("takes three columns only when each still has room for its bars", () => {
    const { container } = renderBreakdown(breakdown());
    const grid = screen.getByRole("heading", { name: "By piece count" })
      .parentElement?.parentElement;
    expect(grid?.className).toContain("xl:grid-cols-3");
    expect(grid?.className).not.toContain(" lg:grid-cols-3");
    expect(container.querySelector(".lg\\:col-span-2")?.textContent).toContain(
      "By piece count",
    );
  });
});

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

  it("names the copies without a difficulty in the app's language, last", () => {
    renderBreakdown(
      breakdown({
        byDifficulty: [
          { label: "medium", value: 1 },
          { label: UNKNOWN_BUCKET, value: 3 },
        ],
      }),
      "nl",
    );
    expect(
      within(screen.getByRole("list", { name: "Op moeilijkheid" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Gemiddeld125%", "Onbekend375%"]);
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

describe("CollectionBreakdown: buckets and brands", () => {
  it("mirrors the domain's sentinel strings", () => {
    // packages/domain/src/insights/collection-breakdown.ts UNKNOWN_BUCKET / OTHER_BUCKET.
    expect(UNKNOWN_BUCKET).toBe("__unknown");
    expect(OTHER_BUCKET).toBe("__other");
  });

  it("translates the sentinel buckets and leaves every other label alone", () => {
    const names = { unknown: "Onbekend", other: "Overig" };
    expect(bucketLabel(UNKNOWN_BUCKET, names)).toBe("Onbekend");
    expect(bucketLabel(OTHER_BUCKET, names)).toBe("Overig");
    expect(bucketLabel("500-999", names)).toBe("500-999");
    expect(bucketLabel("Ravensburger", names)).toBe("Ravensburger");
    // An older backend's English word still renders.
    expect(bucketLabel("Unknown", names)).toBe("Unknown");
  });

  it("never draws copies without a brand as a brand bar, and keeps the query's order", () => {
    expect(
      brandSeries([
        { label: "Ravensburger", value: 4 },
        { label: "Clementoni", value: 2 },
        { label: OTHER_BUCKET, value: 5 },
        { label: UNKNOWN_BUCKET, value: 9 },
      ]),
    ).toEqual({
      bars: [
        { label: "Ravensburger", value: 4 },
        { label: "Clementoni", value: 2 },
        { label: OTHER_BUCKET, value: 5 },
      ],
      withoutBrand: 9,
    });
  });

  it("counts the puzzles without a brand under the brand chart", () => {
    renderBreakdown(
      breakdown({
        byBrand: [
          { label: "Ravensburger", value: 1 },
          { label: UNKNOWN_BUCKET, value: 2 },
        ],
      }),
    );
    expect(screen.getByText("2 puzzles without a brand")).toBeTruthy();
  });

  it("says it in Dutch in the Dutch app, also when no copy has a brand", () => {
    const { container } = renderBreakdown(
      breakdown({ byBrand: [{ label: UNKNOWN_BUCKET, value: 1 }] }),
      "nl",
    );
    expect(screen.getByText("1 puzzel zonder merk")).toBeTruthy();
    expect(container.textContent).not.toContain(UNKNOWN_BUCKET);
  });
});

// Piece count and Top brands read the same way at every width, and without a pointer: horizontal
// bars with their values drawn, in a named figure with a table for screen readers, and no unnamed
// keyboard stop on the chart library's SVG.
describe("CollectionBreakdown: bar charts", () => {
  const tableRows = (name: string) =>
    within(within(screen.getByRole("figure", { name })).getByRole("table"))
      .getAllByRole("row")
      .map((row) => row.textContent);

  it("names the piece count chart and tabulates every bucket, numbers formatted and sentinels translated", () => {
    renderBreakdown(
      breakdown({
        byPieceCount: [
          { label: "100-299", value: 1 },
          { label: "1000-1999", value: 12 },
          { label: UNKNOWN_BUCKET, value: 2 },
        ],
      }),
    );
    expect(tableRows("By piece count")).toEqual([
      "By piece countPuzzles",
      "100–2991",
      "1,000–1,99912",
      "Unknown2",
    ]);
  });

  // The same bucket in Dutch, where the rest of the app shows 1.000.
  it("formats the piece count buckets the Dutch way in the Dutch app", () => {
    renderBreakdown(
      breakdown({ byPieceCount: [{ label: "1000-1999", value: 12 }] }),
      "nl",
    );
    expect(
      within(screen.getByRole("figure", { name: "Op aantal stukjes" }))
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["1.000–1.999"]);
  });

  it("names the brand chart and tabulates its bars, without the copies that have no brand", () => {
    renderBreakdown(
      breakdown({
        byBrand: [
          { label: "Ravensburger", value: 3 },
          { label: OTHER_BUCKET, value: 1 },
          { label: UNKNOWN_BUCKET, value: 2 },
        ],
      }),
    );
    expect(tableRows("Top brands")).toEqual([
      "Top brandsPuzzles",
      "Ravensburger3",
      "Other1",
    ]);
  });

  it("gives a chart one row of height per bar, so seven buckets never squeeze their labels", () => {
    const { container } = renderBreakdown(
      breakdown({
        byPieceCount: [
          "< 100",
          "100-299",
          "300-499",
          "500-999",
          "1000-1999",
          "2000+",
          UNKNOWN_BUCKET,
        ].map((label) => ({ label, value: 1 })),
      }),
    );
    const chart = container.querySelector<HTMLElement>("[data-slot=chart]");
    expect(chart?.style.height).toBe(`${7 * 40}px`);
    expect(chart?.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });
});
