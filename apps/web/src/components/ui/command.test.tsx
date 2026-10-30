// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDialog, CommandInput, CommandList } from "./command";

afterEach(cleanup);

const renderPalette = (open: boolean) =>
  render(
    <main>
      <CommandDialog open={open} title="Search" description="Find a puzzle">
        <CommandInput placeholder="Find a puzzle" />
        <CommandList />
      </CommandDialog>
    </main>,
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
