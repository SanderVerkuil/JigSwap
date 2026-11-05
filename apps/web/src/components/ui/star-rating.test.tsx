// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { StarRating } from "./star-rating";

type Props = ComponentProps<typeof StarRating>;

const withIntl = (ui: React.ReactNode, locale: "en" | "nl") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="UTC"
  >
    {ui}
  </IntlProvider>
);

// A controlled host, so keyboard moves round-trip through onChange like a real form.
function Controlled({
  initial,
  onChange,
  ...rest
}: Omit<Props, "value" | "onChange"> & {
  initial: number;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StarRating
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const renderControlled = (
  props: Omit<Props, "value" | "onChange"> & {
    initial: number;
    onChange?: (value: number) => void;
  },
  locale: "en" | "nl" = "en",
) => render(withIntl(<Controlled label="Your rating" {...props} />, locale));

const radios = () => screen.getAllByRole("radio");
const tabStops = () => radios().filter((radio) => radio.tabIndex === 0);
const checked = () =>
  radios().filter((radio) => radio.getAttribute("aria-checked") === "true");

afterEach(cleanup);

describe("StarRating (interactive)", () => {
  it("is a single Tab stop: the first star when nothing is chosen", () => {
    renderControlled({ initial: 0 });
    expect(tabStops()).toEqual([radios()[0]]);
    expect(checked()).toEqual([]);
  });

  it("is a single Tab stop: the chosen star once there is a rating", () => {
    renderControlled({ initial: 3 });
    expect(tabStops()).toEqual([radios()[2]]);
    expect(checked()).toEqual([radios()[2]]);
  });

  it("names each star with a localised, pluralised label", () => {
    renderControlled({ initial: 0 });
    expect(radios().map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "1 star",
      "2 stars",
      "3 stars",
      "4 stars",
      "5 stars",
    ]);
    cleanup();
    renderControlled({ initial: 0 }, "nl");
    expect(radios().map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "1 ster",
      "2 sterren",
      "3 sterren",
      "4 sterren",
      "5 sterren",
    ]);
  });

  it("moves and selects with the arrow keys like a radio group, clamped at both ends", () => {
    const onChange = vi.fn<(value: number) => void>();
    renderControlled({ initial: 3, onChange });
    const [, , third] = radios();
    third.focus();

    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(checked()).toEqual([radios()[3]]);
    expect(document.activeElement).toBe(radios()[3]);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(checked()).toEqual([radios()[4]]);

    // Past the last star: stays on five rather than wrapping round to one.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(checked()).toEqual([radios()[4]]);
    expect(document.activeElement).toBe(radios()[4]);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(checked()).toEqual([radios()[3]]);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(checked()).toEqual([radios()[2]]);
    expect(document.activeElement).toBe(radios()[2]);
    expect(tabStops()).toEqual([radios()[2]]);

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      4, 5, 5, 4, 3,
    ]);
  });

  it("jumps to one or five stars with Home and End", () => {
    renderControlled({ initial: 3 });
    radios()[2].focus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(checked()).toEqual([radios()[4]]);
    expect(document.activeElement).toBe(radios()[4]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(checked()).toEqual([radios()[0]]);
    expect(document.activeElement).toBe(radios()[0]);
  });

  it("selects the first star with an arrow from an empty rating's tab stop", () => {
    renderControlled({ initial: 0 });
    radios()[0].focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(checked()).toEqual([radios()[0]]);
  });

  it("selects a star on click", () => {
    renderControlled({ initial: 0 });
    fireEvent.click(radios()[1]);
    expect(checked()).toEqual([radios()[1]]);
    expect(tabStops()).toEqual([radios()[1]]);
  });

  it("clears with Delete or Backspace only when clearable, keeping one Tab stop", () => {
    renderControlled({ initial: 4, clearable: true });
    radios()[3].focus();
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    expect(checked()).toEqual([]);
    // The tab stop and focus move together back to the first star.
    expect(tabStops()).toEqual([radios()[0]]);
    expect(document.activeElement).toBe(radios()[0]);

    fireEvent.click(radios()[2]);
    radios()[2].focus();
    fireEvent.keyDown(document.activeElement!, { key: "Backspace" });
    expect(checked()).toEqual([]);
    cleanup();

    const onChange = vi.fn<(value: number) => void>();
    renderControlled({ initial: 4, onChange });
    radios()[3].focus();
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    fireEvent.keyDown(document.activeElement!, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
    expect(checked()).toEqual([radios()[3]]);
  });

  it("labels the group and links its description and required state", () => {
    renderControlled({ initial: 0, describedBy: "hint", required: true });
    const group = screen.getByRole("radiogroup", { name: "Your rating" });
    expect(group.getAttribute("aria-describedby")).toBe("hint");
    expect(group.getAttribute("aria-required")).toBe("true");
    cleanup();
    renderControlled({ initial: 0 });
    const plain = screen.getByRole("radiogroup", { name: "Your rating" });
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
    expect(plain.hasAttribute("aria-required")).toBe(false);
  });

  it("gives every star at least a 32px hit area, 44px on touch screens", () => {
    renderControlled({ initial: 0, size: "sm" });
    for (const radio of radios()) {
      expect(radio.className).toContain("size-8");
      expect(radio.className).toContain("pointer-coarse:size-11");
    }
  });
});

describe("StarRating (read-only)", () => {
  it("reads out the score in the member's language", () => {
    render(withIntl(<StarRating value={3} />, "en"));
    expect(screen.getByRole("img", { name: "3 out of 5 stars" })).toBeTruthy();
    cleanup();
    render(withIntl(<StarRating value={1} />, "nl"));
    expect(screen.getByRole("img", { name: "1 van 5 sterren" })).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toEqual([]);
  });

  it("prefers the caller's label", () => {
    render(withIntl(<StarRating value={4} label="Rated 4" />, "en"));
    expect(screen.getByRole("img", { name: "Rated 4" })).toBeTruthy();
  });
});
