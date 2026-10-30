// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { CommandDialog, CommandInput, CommandList } from "./command";

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
});
