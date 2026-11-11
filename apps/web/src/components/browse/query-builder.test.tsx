// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  EMPTY_QUERY,
  QueryBuilder,
  type QueryBuilderState,
} from "./query-builder";

function Harness({ initial }: { initial: Partial<QueryBuilderState> }) {
  const [value, setValue] = useState({ ...EMPTY_QUERY, ...initial });
  const tBrowse = useTranslations("browse");
  const tEnum = useTranslations("puzzles");
  return (
    <>
      <QueryBuilder
        value={value}
        onChange={setValue}
        categories={[{ id: "cat_1", name: "Animals" }]}
        tBrowse={tBrowse as (key: string) => string}
        tEnum={tEnum as (key: string) => string}
      />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

const renderBuilder = (initial: Partial<QueryBuilderState> = {}) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Harness initial={initial} />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("QueryBuilder: search box", () => {
  const box = () =>
    screen.getByRole("searchbox", { name: en.browse.searchLabel });

  it("is on screen from the start, and types into the text condition", () => {
    renderBuilder();
    fireEvent.change(box(), { target: { value: "lake" } });
    expect(screen.getByTestId("state").textContent).toContain('"text":"lake"');
  });

  it("is no longer offered as a filter to add", () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: en.browse.addFilter }));
    expect(screen.queryByRole("option", { name: "Text" })).toBeNull();
    expect(
      screen.getByRole("option", { name: en.browse.fieldAvailability }),
    ).toBeTruthy();
  });

  it("offers Clear All once there is a term, and clears it", () => {
    renderBuilder({ text: "lake" });
    fireEvent.click(
      screen.getByRole("button", { name: en.browse.clearFilters }),
    );
    expect((box() as HTMLInputElement).value).toBe("");
  });
});

describe("QueryBuilder: Add Filter", () => {
  // A plain button beside the search box, as the catalogue's toolbar buttons are: not a pill.
  it("has the toolbar's button shape", () => {
    renderBuilder();
    expect(
      screen.getByRole("button", { name: en.browse.addFilter }).className,
    ).not.toContain("rounded-full");
  });
});

describe("QueryBuilder: focus when a condition goes away", () => {
  const addFilter = () =>
    screen.getByRole("button", { name: en.browse.addFilter });

  it("moves to Add Filter when a condition is removed", () => {
    renderBuilder({ difficulty: "hard", availability: ["forTrade"] });
    const remove = screen.getByRole("button", {
      name: `${en.browse.removeFilter}: ${en.browse.fieldAvailability}`,
    });
    remove.focus();
    fireEvent.click(remove);

    expect(document.activeElement).toBe(addFilter());
    expect(
      screen.queryByRole("button", {
        name: `${en.browse.removeFilter}: ${en.browse.fieldAvailability}`,
      }),
    ).toBeNull();
  });

  it("moves to Add Filter on Clear All", () => {
    renderBuilder({ difficulty: "hard" });
    const clear = screen.getByRole("button", { name: en.browse.clearFilters });
    clear.focus();
    fireEvent.click(clear);

    expect(document.activeElement).toBe(addFilter());
  });

  it("can move there even with every condition on screen", () => {
    renderBuilder({
      category: "cat_1",
      condition: "good",
      difficulty: "hard",
      minPieces: "500",
      availability: ["forTrade"],
    });
    expect((addFilter() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("QueryBuilder: piece count", () => {
  // Layout itself can't be measured here: the 320px check was done in a browser.
  it("lets its two inputs narrow, so the chip's remove button stays on a small phone", () => {
    renderBuilder({ minPieces: "500" });
    for (const name of [en.browse.minPieces, en.browse.maxPieces]) {
      const input = screen.getByRole("spinbutton", { name });
      expect(input.className).toContain("max-w-20");
      expect(input.className).not.toMatch(/(^|\s)w-20(\s|$)/);
      expect(input.parentElement?.className).toContain("min-w-0");
    }
  });

  it("shows short placeholders that fit and keeps the full names for screen readers", () => {
    renderBuilder({ minPieces: "", maxPieces: "1000" });

    const min = screen.getByRole("spinbutton", { name: en.browse.minPieces });
    const max = screen.getByRole("spinbutton", { name: en.browse.maxPieces });
    expect(min.getAttribute("placeholder")).toBe("Min");
    expect(max.getAttribute("placeholder")).toBe("Max");
  });
});
