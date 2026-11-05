// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { BulkActionBar } from "./bulk-action-bar";

// The selection bar says how many puzzles are selected, selects or clears them all, and offers the
// five bulk actions only once something is selected.

const handlers = () => ({
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onExit: vi.fn(),
  onOffer: vi.fn(),
  onAddToCollection: vi.fn(),
  onShareWithCircle: vi.fn(),
});

const renderBar = (props: Partial<ComponentProps<typeof BulkActionBar>>) => {
  const on = handlers();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <BulkActionBar selectedCount={0} selectableCount={5} {...on} {...props} />
    </IntlProvider>,
  );
  return on;
};

// The wide layout's buttons (the narrow one puts the offers in a menu; CSS picks one).
const inline = () => within(screen.getByTestId("bulk-actions-inline"));
const ACTIONS = [
  "Offer for swap",
  "Offer to lend",
  "Withdraw offers",
  "Add to collection",
  "Share with circle",
];

afterEach(cleanup);

describe("BulkActionBar", () => {
  it("is a named region that announces the selected count", () => {
    renderBar({ selectedCount: 3 });
    const region = screen.getByRole("region", {
      name: "Actions for the selected puzzles",
    });
    expect(
      within(region).getByText("3 selected").getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("keeps every action disabled until something is selected", () => {
    renderBar({ selectedCount: 0 });
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    for (const name of ACTIONS)
      expect(
        (inline().getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    const compact = within(screen.getByTestId("bulk-actions-compact"));
    expect(
      (compact.getByRole("button", { name: "Offers" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("runs the chosen action", () => {
    const on = renderBar({ selectedCount: 2 });
    fireEvent.click(inline().getByRole("button", { name: "Offer for swap" }));
    fireEvent.click(inline().getByRole("button", { name: "Withdraw offers" }));
    fireEvent.click(
      inline().getByRole("button", { name: "Add to collection" }),
    );
    expect(on.onOffer.mock.calls).toEqual([["offerSwap"], ["withdraw"]]);
    expect(on.onAddToCollection).toHaveBeenCalledOnce();
  });

  it("offers Share with circle in both layouts", () => {
    const on = renderBar({ selectedCount: 2 });
    fireEvent.click(
      inline().getByRole("button", { name: "Share with circle" }),
    );
    fireEvent.click(
      within(screen.getByTestId("bulk-actions-compact")).getByRole("button", {
        name: "Share with circle",
      }),
    );
    expect(on.onShareWithCircle).toHaveBeenCalledTimes(2);
  });

  it("disables the actions while one is running", () => {
    renderBar({ selectedCount: 2, busy: true });
    for (const name of ACTIONS)
      expect(
        (inline().getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
  });

  it("offers Select all with the count, and Clear once everything is selected", () => {
    const on = renderBar({ selectedCount: 2, selectableCount: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Select all (5)" }));
    expect(on.onSelectAll).toHaveBeenCalledOnce();
    cleanup();

    const all = renderBar({ selectedCount: 5, selectableCount: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(all.onClear).toHaveBeenCalledOnce();
  });

  it("opens the Offers menu without locking the page's scroll", async () => {
    // A scroll lock stops the sticky bar sticking: on a phone it drops to the end of the list and
    // takes the menu off screen with it. happy-dom has no layout, so the lock is what's checked.
    renderBar({ selectedCount: 2 });
    const compact = within(screen.getByTestId("bulk-actions-compact"));
    const trigger = compact.getByRole("button", { name: "Offers" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(
      await screen.findByRole("menuitem", { name: "Offer to lend" }),
    ).toBeTruthy();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  });

  it("leaves selection mode from its own close button", () => {
    const on = renderBar({ selectedCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Stop selecting" }));
    expect(on.onExit).toHaveBeenCalledOnce();
  });
});
