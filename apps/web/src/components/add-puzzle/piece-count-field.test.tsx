// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PieceCountField } from "./piece-count-field";

const Form = ({
  start,
  locale = "en",
}: {
  start?: number;
  locale?: "en" | "nl";
}) => {
  const [value, setValue] = useState(start);
  return (
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <PieceCountField id="pieces" value={value} onChange={setValue} />
      <output>{value === undefined ? "none" : value}</output>
    </IntlProvider>
  );
};

const type = (value: string) =>
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
const field = () => screen.getByRole<HTMLInputElement>("spinbutton").value;
const held = () => screen.getByRole("status").textContent;
const preset = (name: string) => screen.getByRole("button", { name });

afterEach(cleanup);

describe("PieceCountField", () => {
  it("takes a piece count up to the most the server accepts", () => {
    render(<Form />);
    type("1000000");
    expect(field()).toBe("1000000");
    expect(held()).toBe("1000000");
  });

  it("keeps the number when one more digit would pass the limit", () => {
    render(<Form start={1000000} />);
    type("10000000");
    expect(field()).toBe("1000000");
    expect(held()).toBe("1000000");
  });

  it.each(["0", "-5", "1.5"])(
    "ignores %s instead of blanking the field",
    (typed) => {
      render(<Form start={250} />);
      type(typed);
      expect(field()).toBe("250");
      expect(held()).toBe("250");
    },
  );

  it("clearing the field clears the value", () => {
    render(<Form start={250} />);
    type("");
    expect(field()).toBe("");
    expect(held()).toBe("none");
  });

  it("offers the presets", () => {
    render(<Form />);
    fireEvent.click(preset("500"));
    expect(held()).toBe("500");
  });

  // A bare "1000" read as a value already typed, and the same as a preset.
  it.each([
    ["en", "e.g. 1000"],
    ["nl", "bijv. 1000"],
  ] as const)(
    "shows an example, not a value, as its %s placeholder",
    (locale, example) => {
      render(<Form locale={locale} />);
      expect(screen.getByRole("spinbutton").getAttribute("placeholder")).toBe(
        example,
      );
    },
  );

  // The picked preset is told by more than its fill: a pressed state and a Canal Link edge.
  it("marks the picked preset as pressed, with an edge as well as a tint", () => {
    render(<Form start={500} />);
    expect(preset("500").getAttribute("aria-pressed")).toBe("true");
    expect(preset("1000").getAttribute("aria-pressed")).toBe("false");
    expect(preset("500").className).toContain("border-primary-text");
    expect(preset("1000").className).not.toContain("border-primary-text");

    fireEvent.click(preset("1000"));
    expect(preset("1000").getAttribute("aria-pressed")).toBe("true");
    expect(preset("500").getAttribute("aria-pressed")).toBe("false");
  });
});
