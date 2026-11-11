// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

afterEach(cleanup);

// The primitives label their close button through the app catalogue.
const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {children}
  </IntlProvider>
);

const renderPalette = (open: boolean) =>
  render(
    <main>
      <CommandDialog open={open} title="Search" description="Find a puzzle">
        <CommandInput placeholder="Find a puzzle" />
        <CommandList />
      </CommandDialog>
    </main>,
    { wrapper },
  );

describe("CommandDialog", () => {
  it("leaves no heading in the page while closed", () => {
    renderPalette(false);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("Search")).toBeNull();
  });

  it("names the open dialog with its title, rendered inside the dialog", () => {
    renderPalette(true);
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog.contains(screen.getByText("Search"))).toBe(true);
    expect(dialog.contains(screen.getByText("Find a puzzle"))).toBe(true);
  });

  // The list changes height on every keystroke ("Searching…" and back). Centred, the dialog
  // moved the input up and down with it; anchored at the top, only the list grows.
  it("anchors the open palette near the top instead of centring it", () => {
    renderPalette(true);
    const list = screen
      .getByRole("dialog", { name: "Search" })
      .className.split(/\s+/);
    expect(list).toEqual(
      expect.arrayContaining([
        "top-[12vh]",
        "translate-y-0",
        "max-md:top-4",
        "[@media(max-height:500px)]:top-4",
      ]),
    );
    expect(list).not.toContain("top-[50%]");
    expect(list).not.toContain("translate-y-[-50%]");
  });

  // Focus stays in the input, so the item Enter runs is cmdk's selection: tinted at 1.15:1, it
  // also carries a --ring outline.
  it("outlines the selected item, not only tints it", () => {
    render(
      <CommandDialog open title="Search" description="Find a puzzle">
        <CommandInput placeholder="Find a puzzle" />
        <CommandList>
          <CommandGroup>
            <CommandItem>Puzzles</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>,
      { wrapper },
    );
    const item = screen.getByRole("option", { name: "Puzzles" });
    expect(item.getAttribute("data-selected")).toBe("true");
    expect(item.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "data-[selected=true]:outline-solid",
        "data-[selected=true]:outline-2",
        "data-[selected=true]:outline-ring",
      ]),
    );
  });
});
