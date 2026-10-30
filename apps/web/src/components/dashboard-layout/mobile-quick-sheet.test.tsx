// @vitest-environment happy-dom
// UX-58: every quick-sheet row opens what it promises. "Log a Completion" opens the log flow, not
// the list, and "Find a swap" opens Browse (where swaps start) instead of the exchanges list.
// UX-06: Messages has a row of its own, with the unread count as a pill and in its name.
// UX-56: phones have no top-bar theme or language menus, so the sheet carries both choices.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MobileQuickSheet } from "./mobile-quick-sheet";

const mocks = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/components/install-app/use-install-app", () => ({
  useInstallMethod: () => null,
  requestInstallTip: vi.fn(),
  runInstallPrompt: vi.fn(),
}));

const renderSheet = (locale: "en" | "nl" = "en", unreadMessages = 0) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MobileQuickSheet
        open
        onOpenChange={() => {}}
        whatsNewCount={0}
        unreadMessages={unreadMessages}
      />
    </IntlProvider>,
  );

const rowNames = () =>
  screen
    .getAllByRole("button")
    .map((button) => button.querySelector(".font-semibold")?.textContent)
    .filter(Boolean);

beforeEach(() => {
  mocks.push.mockReset();
});

afterEach(cleanup);

describe("MobileQuickSheet", () => {
  it.each([
    ["Add a Puzzle", "/my-puzzles/add"],
    ["Log a Completion", "/completions/new"],
    ["Find a swap", "/browse"],
    ["Messages", "/messages"],
    ["Profile", "/profile"],
    ["What's new", "/whats-new"],
  ])("“%s” goes to %s", (name, href) => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    expect(mocks.push).toHaveBeenCalledWith(href);
  });

  it("offers one swap entry and no row that only opens a list", () => {
    renderSheet();
    expect(rowNames()).toEqual([
      "Add a Puzzle",
      "Log a Completion",
      "Find a swap",
      "Messages",
      "Profile",
      "What's new",
    ]);
  });

  it("names the swap row in Dutch", () => {
    renderSheet("nl");
    expect(screen.getByRole("button", { name: /Zoek een ruil/ })).toBeTruthy();
  });

  it("shows the unread messages on the Messages row and in its name", () => {
    renderSheet("en", 3);
    const row = screen.getByRole("button", { name: /3 unread messages/ });
    expect(row.textContent).toContain("Messages");
    const pill = row.querySelector("[aria-hidden]:not(svg)");
    expect(pill?.textContent).toBe("3");
  });

  it("offers the theme and language choices below the actions", () => {
    renderSheet();
    const lastRow = screen.getByRole("button", { name: /What's new/ });
    for (const name of ["Theme", "Language"]) {
      const group = screen.getByRole("radiogroup", { name });
      expect(
        lastRow.compareDocumentPosition(group) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["Light", "Dark", "System", "English", "Nederlands"]);
  });

  it("names the choices in Dutch", () => {
    renderSheet("nl");
    expect(screen.getByRole("radiogroup", { name: "Thema" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Taal" })).toBeTruthy();
  });
});
