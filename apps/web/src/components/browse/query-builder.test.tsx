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

describe("QueryBuilder: piece count", () => {
  it("shows short placeholders that fit and keeps the full names for screen readers", () => {
    renderBuilder({ minPieces: "", maxPieces: "1000" });

    const min = screen.getByRole("spinbutton", { name: en.browse.minPieces });
    const max = screen.getByRole("spinbutton", { name: en.browse.maxPieces });
    expect(min.getAttribute("placeholder")).toBe("Min");
    expect(max.getAttribute("placeholder")).toBe("Max");
  });
});
