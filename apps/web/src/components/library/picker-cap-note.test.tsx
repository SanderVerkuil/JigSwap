// @vitest-environment happy-dom
import { LIBRARY_ROWS_MAX } from "@jigswap/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PickerCapNote } from "./picker-cap-note";

const renderAt = (shown: number, locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <PickerCapNote shown={shown} />
    </IntlProvider>,
  );

describe("PickerCapNote", () => {
  afterEach(cleanup);

  it("says nothing while the picker holds the whole library", () => {
    const { container } = renderAt(LIBRARY_ROWS_MAX - 1);
    expect(container.textContent).toBe("");
  });

  it("says older copies were left out once the read's maximum came back", () => {
    renderAt(LIBRARY_ROWS_MAX);
    expect(
      screen.getByText(`Showing your newest ${LIBRARY_ROWS_MAX} puzzles.`),
    ).toBeTruthy();
  });

  it("does so in Dutch too", () => {
    renderAt(LIBRARY_ROWS_MAX, "nl");
    expect(
      screen.getByText(`Je ziet je nieuwste ${LIBRARY_ROWS_MAX} puzzels.`),
    ).toBeTruthy();
  });
});
