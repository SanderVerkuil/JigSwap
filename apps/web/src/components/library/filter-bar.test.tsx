// @vitest-environment happy-dom
import { FilterBar as CommunityFilterBar } from "@/components/community/primitives";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterBar } from "./filter-bar";

// A selected filter used to be the canal-filled default Button, the same look as the page's
// primary action beside it. Both FilterBars now sit in the tab track: a muted track whose chosen
// option is a white window at 600, edged in Night Link after dark.

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "incoming", label: "Incoming" },
] as const;

const classesOf = (element: Element) => [...element.classList];

afterEach(cleanup);

describe.each([
  [
    "library FilterBar",
    (onChange: (value: string) => void) =>
      render(
        <FilterBar
          options={[...OPTIONS]}
          value="all"
          onChange={onChange}
          count="2 puzzles"
        />,
      ),
  ],
  [
    "community FilterBar",
    (onChange: (value: string) => void) =>
      render(
        <CommunityFilterBar
          filters={[
            { ...OPTIONS[0] },
            { ...OPTIONS[1], "data-tour": "trades-incoming" },
          ]}
          value="all"
          onChange={onChange}
          count="2 trades"
        />,
      ),
  ],
])("%s", (_name, renderBar) => {
  it("marks the chosen option with aria-pressed, not with the primary button's fill", () => {
    renderBar(vi.fn());
    const chosen = screen.getByRole("button", { name: "All" });
    const other = screen.getByRole("button", { name: "Incoming" });
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(other.getAttribute("aria-pressed")).toBe("false");
    for (const option of [chosen, other]) {
      expect(classesOf(option)).not.toContain("bg-primary");
      expect(classesOf(option)).not.toContain("border");
    }
    expect(classesOf(chosen)).toEqual(
      expect.arrayContaining([
        "bg-background",
        "font-semibold",
        // The edge shows the choice in both themes: white on the track alone is 1.1:1.
        "inset-ring",
        "inset-ring-primary-text",
      ]),
    );
    // The window holds still under the pointer: the ghost hover fill is merged away.
    expect(classesOf(chosen)).not.toContain("hover:bg-accent");
    expect(classesOf(chosen)).not.toContain("dark:hover:bg-accent/50");
    expect(classesOf(other)).not.toContain("bg-background");
  });

  it("sits the options in one muted tab track", () => {
    renderBar(vi.fn());
    const track = screen.getByRole("button", { name: "All" }).parentElement!;
    expect(classesOf(track)).toEqual(
      expect.arrayContaining(["bg-muted", "rounded-lg", "p-[3px]"]),
    );
    expect(screen.getByRole("button", { name: "Incoming" }).parentElement).toBe(
      track,
    );
  });

  it("reports the option pressed", () => {
    const onChange = vi.fn();
    renderBar(onChange);
    fireEvent.click(screen.getByRole("button", { name: "Incoming" }));
    expect(onChange).toHaveBeenCalledWith("incoming");
  });
});

it("keeps an option's tour anchor on the option itself", () => {
  render(
    <CommunityFilterBar
      data-tour="trades-tabs"
      filters={[
        { ...OPTIONS[0] },
        { ...OPTIONS[1], "data-tour": "trades-incoming" },
      ]}
      value="all"
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Incoming" }).getAttribute("data-tour"),
  ).toBe("trades-incoming");
});
