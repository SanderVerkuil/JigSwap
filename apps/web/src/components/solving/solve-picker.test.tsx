// @vitest-environment happy-dom
import type { SolvePickerItem, SolvePickerSection } from "@/lib/solve-picker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { SolvePicker } from "./solve-picker";

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The "Log a solve" picker: every puzzle is a real button with a name that says what picking
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
  {
    id: "borrowed",
    items: [
      log("loan-1", "Kattenkwaad", {
        target: { kind: "log", copyId: "loan-1", viewerIsOwner: false },
      }),
    ],
  },
  {
    id: "household",
    items: [
      log("hh-1", "Alpen", {
        ownerName: "Anna",
        target: { kind: "log", copyId: "hh-1", viewerIsOwner: false },
      }),
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
      "Borrowed",
      "Household",
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
      "Kattenkwaad: log a solve, 1,000 pieces",
      "Alpen: log a solve, 1,000 pieces · Anna's copy",
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

  it("makes cards in one row the same height, however long a title is", () => {
    renderPicker(SECTIONS);
    const card = screen.getAllByRole("button")[0];
    expect(card?.className.split(/\s+/)).toContain("h-full");
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
      { id: "borrowed", items: [] },
      { id: "household", items: [] },
    ]);
    expect(sectionHeadings()).toEqual(["Your puzzles"]);
  });

  it("filters every section by the search and says when nothing matches", () => {
    renderPicker(SECTIONS);
    const search = screen.getByRole("searchbox", { name: "Search puzzles" });
    fireEvent.change(search, { target: { value: "katten" } });
    expect(sectionHeadings()).toEqual(["Your puzzles", "Borrowed"]);
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.change(search, { target: { value: "anna" } });
    expect(sectionHeadings()).toEqual(["Household"]);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(screen.getByText("No puzzles match “zzz”")).toBeDefined();
  });

  it("offers a way forward when there is nothing to log at all", () => {
    renderPicker(EMPTY);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("Nothing to log yet")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Add a puzzle" }).getAttribute("href"),
    ).toBe("/my-puzzles/add");
    expect(
      screen
        .getByRole("link", { name: "Find a puzzle to borrow" })
        .getAttribute("href"),
    ).toBe("/browse");
  });

  it("speaks Dutch", () => {
    renderPicker(SECTIONS, () => {}, "nl");
    expect(sectionHeadings()).toEqual([
      "Nog bezig: rond er een af",
      "Je eigen puzzels",
      "Geleend",
      "Huishouden",
    ]);
    expectButtonNames([
      "Lam Gelegd: voltooiing afronden, 500 stukjes, Bezig sinds 3 okt 2026",
      "De Kattenshow: voltooiing vastleggen, Jumbo · 1.000 stukjes",
      "Tirol: voltooiing vastleggen, Ravensburger · 3.000 stukjes",
      "Kattenkwaad: voltooiing vastleggen, 1.000 stukjes",
      "Alpen: voltooiing vastleggen, 1.000 stukjes · Exemplaar van Anna",
    ]);
  });
});
