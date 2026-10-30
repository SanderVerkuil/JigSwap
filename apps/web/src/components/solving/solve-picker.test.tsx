// @vitest-environment happy-dom
import type { SolvePickerItem, SolvePickerSection } from "@/lib/solve-picker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { SolvePicker } from "./solve-picker";

// The "Log a completion" picker: every puzzle is a real button with a name that says what picking
// it does, under visible section headings, with the solves in progress first.

const STARTED = Date.UTC(2026, 9, 3);

const log = (key: string, title: string, over: Partial<SolvePickerItem> = {}) =>
  ({
    key,
    title,
    pieceCount: 1000,
    target: { kind: "log", copyId: key, viewerIsOwner: true },
    ...over,
  }) satisfies SolvePickerItem;

const SECTIONS: SolvePickerSection[] = [
  {
    id: "inProgress",
    items: [
      {
        key: "c-1",
        title: "Lam Gelegd",
        pieceCount: 500,
        target: { kind: "finish", completionId: "c-1", startDate: STARTED },
      },
    ],
  },
  {
    id: "own",
    items: [
      log("own-1", "De Kattenshow", { brand: "Jumbo" }),
      log("own-2", "Tirol", { brand: "Ravensburger", pieceCount: 3000 }),
    ],
  },
];

const EMPTY: SolvePickerSection[] = SECTIONS.map((s) => ({ ...s, items: [] }));

const renderPicker = (
  sections: SolvePickerSection[],
  onPick: (
    item: SolvePickerItem,
    trigger: HTMLButtonElement,
  ) => void = () => {},
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="America/Los_Angeles"
    >
      <SolvePicker sections={sections} onPick={onPick} />
    </IntlProvider>,
  );

// The buttons, in order, have exactly these accessible names. The name is computed from the row's
// text, element by element, so the space before the punctuation that separates them is ignored.
const tidy = (name: string) => name.replace(/\s+([,:])/g, "$1");
const named = (expected: string | RegExp) => (name: string) =>
  typeof expected === "string"
    ? tidy(name) === expected
    : expected.test(tidy(name));
const expectButtonNames = (names: string[]) => {
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(names.length);
  names.forEach((name, index) => {
    expect(screen.getByRole("button", { name: named(name) })).toBe(
      buttons[index],
    );
  });
};

const sectionHeadings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

afterEach(cleanup);

describe("SolvePicker", () => {
  it("puts the solves in progress first, under a visible heading per section", () => {
    renderPicker(SECTIONS);
    expect(sectionHeadings()).toEqual([
      "In progress: finish one",
      "Your puzzles",
    ]);
  });

  it("makes every puzzle a button named after it and what picking it does", () => {
    renderPicker(SECTIONS);
    // The name is the row's own text, so it holds everything the row shows (WCAG 2.5.3). The
    // start is a calendar date (UTC midnight): it reads 3 Oct even west of UTC.
    expectButtonNames([
      "Lam Gelegd: finish solve, 500 pieces, In progress since Oct 3, 2026",
      "De Kattenshow: log a solve, Jumbo · 1,000 pieces",
      "Tirol: log a solve, Ravensburger · 3,000 pieces",
    ]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("names a solve in progress whose puzzle lost its title", () => {
    renderPicker([
      {
        id: "inProgress",
        items: [
          {
            key: "c-1",
            target: { kind: "finish", completionId: "c-1", startDate: STARTED },
          },
        ],
      },
    ]);
    expectButtonNames([
      "Untitled puzzle: finish solve, In progress since Oct 3, 2026",
    ]);
  });

  it("shows no copy condition or availability badges", () => {
    renderPicker(SECTIONS);
    for (const label of ["Good", "For Trade", "For Lend", "Private"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("hands the picked item and its button back to the page", () => {
    const picked: [string, string | null][] = [];
    renderPicker(SECTIONS, (item, trigger) =>
      picked.push([item.key, trigger.textContent]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: named(/^Tirol: log a solve,/) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: named(/^Lam Gelegd: finish solve,/) }),
    );
    expect(picked).toEqual([
      ["own-2", "Tirol: log a solve, Ravensburger · 3,000 pieces"],
      [
        "c-1",
        "Lam Gelegd: finish solve, 500 pieces, In progress since Oct 3, 2026",
      ],
    ]);
  });

  it("hides sections with nothing in them", () => {
    renderPicker([
      { id: "inProgress", items: [] },
      { id: "own", items: [log("own-1", "De Kattenshow")] },
    ]);
    expect(sectionHeadings()).toEqual(["Your puzzles"]);
  });

  it("filters every section by the search and says when nothing matches", () => {
    renderPicker(SECTIONS);
    const search = screen.getByRole("searchbox", { name: "Search puzzles" });
    fireEvent.change(search, { target: { value: "katten" } });
    expect(sectionHeadings()).toEqual(["Your puzzles"]);
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(screen.getByText("No puzzles match “zzz”")).toBeDefined();
  });

  it("shows no search when there is nothing to pick", () => {
    renderPicker(EMPTY);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("No puzzles yet")).toBeDefined();
  });

  it("speaks Dutch", () => {
    renderPicker(SECTIONS, () => {}, "nl");
    expect(sectionHeadings()).toEqual([
      "Nog bezig: rond er een af",
      "Je eigen puzzels",
    ]);
    expectButtonNames([
      "Lam Gelegd: voltooiing afronden, 500 stukjes, Bezig sinds 3 okt 2026",
      "De Kattenshow: voltooiing vastleggen, Jumbo · 1.000 stukjes",
      "Tirol: voltooiing vastleggen, Ravensburger · 3.000 stukjes",
    ]);
  });
});
