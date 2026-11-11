// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Switch } from "./switch";

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("Switch", () => {
  // In light the unchecked track (--input under a white thumb, on white) is 1.5:1, below the 3:1
  // a control's boundary needs (1.4.11). Its 1px edge carries it in Ink Muted; at night the
  // track and thumb already stand off the card, so the edge stays transparent there.
  it("gives the unchecked track an Ink Muted edge in light only", () => {
    render(<Switch aria-label="Offer to lend" />);
    const list = classes(screen.getByRole("switch", { name: "Offer to lend" }));
    expect(list).toEqual(
      expect.arrayContaining([
        "border",
        "data-[state=unchecked]:border-muted-foreground",
        "dark:data-[state=unchecked]:border-transparent",
      ]),
    );
  });

  // The unchecked edge comes later in the stylesheet than focus-visible:border-ring, so keyboard
  // focus has to restate the ring colour for that state, in both themes.
  it("keeps the ring-coloured edge on keyboard focus while unchecked", () => {
    render(<Switch aria-label="Offer to lend" />);
    const list = classes(screen.getByRole("switch", { name: "Offer to lend" }));
    expect(list).toEqual(
      expect.arrayContaining([
        "focus-visible:data-[state=unchecked]:border-ring",
        "dark:focus-visible:data-[state=unchecked]:border-ring",
      ]),
    );
  });
});
