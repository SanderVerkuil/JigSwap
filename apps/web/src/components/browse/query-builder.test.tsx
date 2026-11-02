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
      text: "lake",
    });
    expect((addFilter() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("QueryBuilder: piece count", () => {
  it("shows short placeholders that fit and keeps the full names for screen readers", () => {
    renderBuilder({ minPieces: "", maxPieces: "1000" });

    const min = screen.getByRole("spinbutton", { name: en.browse.minPieces });
    const max = screen.getByRole("spinbutton", { name: en.browse.maxPieces });
    expect(min.getAttribute("placeholder")).toBe("Min");
    expect(max.getAttribute("placeholder")).toBe("Max");
  });
});
