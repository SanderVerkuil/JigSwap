// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CircleAvatarStack, type StackMember } from "./circle-avatar-stack";

const NAMES = ["Ada", "Bram", "Cleo", "Daan", "Eva", "Fenna", "Gijs"];
const members = (count: number): StackMember[] =>
  NAMES.slice(0, count).map((name) => ({
    key: name,
    name,
    fallback: name[0],
  }));

const renderStack = (count: number) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <CircleAvatarStack circleName="Family" members={members(count)} />
    </IntlProvider>,
  );

const tile = (name: string) => screen.getByRole("button", { name });
const tiles = () => [...screen.getByRole("group").querySelectorAll("button")];
const tooltipText = () =>
  screen.queryAllByRole("tooltip").map((el) => el.textContent);

// The margin class of each tile after the first: "-ml-2.5" stacked, "ml-1" apart.
const spacing = () =>
  tiles()
    .slice(1)
    .map((el) => (el.className.includes("-ml-2.5") ? "stacked" : "apart"));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CircleAvatarStack", () => {
  it("labels the group and every avatar with the member's name", () => {
    renderStack(3);
    expect(
      screen.getByRole("group", { name: "Members of Family" }),
    ).toBeTruthy();
    expect(tiles().map((el) => el.getAttribute("aria-label"))).toEqual([
      "Ada",
      "Bram",
      "Cleo",
    ]);
    expect(spacing()).toEqual(["stacked", "stacked"]);
  });

  it("draws five avatars and +N from lg up, three and +N below", () => {
    renderStack(7);
    // happy-dom applies no CSS: assert the responsive classes instead.
    expect(tiles()).toHaveLength(5);
    expect(
      tiles().map((el) => el.className.includes("hidden lg:flex")),
    ).toEqual([false, false, false, true, true]);
    const wide = screen.getByRole("img", { name: "2 more members" });
    const narrow = screen.getByRole("img", { name: "4 more members" });
    expect(wide.textContent).toBe("+2");
    expect(wide.className).toContain("hidden lg:flex");
    expect(narrow.textContent).toBe("+4");
    expect(narrow.className).toContain("lg:hidden");
  });

  it("shows no counter when every member fits", () => {
    renderStack(3);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("keyboard focus reveals that avatar and names it", () => {
    renderStack(5);
    const middle = tile("Cleo");
    // happy-dom has no :focus-visible; keyboard focus is what sets it.
    const matches = vi
      .spyOn(middle, "matches")
      .mockImplementation((selector) => selector === ":focus-visible");
    act(() => middle.focus());
    // [A][B]] [C] [D][E]] — a gap before and after the focused avatar only.
    expect(spacing()).toEqual(["stacked", "apart", "apart", "stacked"]);
    expect(middle.className).toContain("z-10");
    expect(tooltipText()).toContain("Cleo");

    act(() => middle.blur());
    expect(spacing()).toEqual(["stacked", "stacked", "stacked", "stacked"]);
    matches.mockRestore();
  });

  it("is reachable with Tab: every avatar is a focusable button", () => {
    renderStack(5);
    for (const el of tiles()) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
      expect(el.tabIndex).toBe(0);
    }
  });

  it("a mouse pointer reveals the avatar under it and names it", () => {
    vi.useFakeTimers();
    renderStack(5);
    const middle = tile("Cleo");
    fireEvent.pointerEnter(middle, { pointerType: "mouse" });
    fireEvent.pointerMove(middle, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(spacing()).toEqual(["stacked", "apart", "apart", "stacked"]);
    expect(tooltipText()).toContain("Cleo");

    fireEvent.pointerLeave(screen.getByRole("group"), { pointerType: "mouse" });
    expect(spacing()).toEqual(["stacked", "stacked", "stacked", "stacked"]);
  });

  it("a tap toggles the avatar's name on touch", () => {
    renderStack(5);
    const second = tile("Bram");
    fireEvent.pointerDown(second, { pointerType: "touch" });
    fireEvent.click(second);
    expect(tooltipText()).toContain("Bram");
    expect(spacing()).toEqual(["apart", "apart", "stacked", "stacked"]);

    fireEvent.pointerDown(second, { pointerType: "touch" });
    fireEvent.click(second);
    expect(tooltipText()).not.toContain("Bram");
  });
});
