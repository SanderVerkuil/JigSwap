// @vitest-environment happy-dom
// UX-58: every quick-sheet row opens what it promises. "Log a solve" opens the log flow, not
// the list, and "Find a swap" opens Browse (where swaps start) instead of the exchanges list.
// UX-06: Messages has a row of its own, with the unread count as a pill and in its name.
// UX-56: phones have no top-bar theme or language menus, so the sheet carries both choices.
// UX-91: Help & guides, right after What's new, opens the Guides tab.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MobileQuickSheet } from "./mobile-quick-sheet";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(to: { href: string }) => void>(),
  onOpenChange: vi.fn<(open: boolean) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

// No install entry: the browser offers no install route in the test.
vi.mock("@/components/install-app/use-install-app", () => ({
  useInstallMethod: () => null,
  requestInstallTip: vi.fn(),
  runInstallPrompt: vi.fn(),
}));

const renderSheet = (
  locale: "en" | "nl" = "en",
  { unreadMessages = 0, whatsNewCount = 0 } = {},
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MobileQuickSheet
        open
        onOpenChange={mocks.onOpenChange}
        whatsNewCount={whatsNewCount}
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
  mocks.navigate.mockReset();
  mocks.onOpenChange.mockReset();
});

afterEach(cleanup);

describe("MobileQuickSheet", () => {
  it.each([
    ["Add a Puzzle", "/my-puzzles/add"],
    ["Log a solve", "/completions/new"],
    ["Find a swap", "/browse"],
    ["Messages", "/messages"],
    ["Profile", "/profile"],
    ["What's new", "/whats-new"],
    ["Docs", "/docs"],
  ])("“%s” goes to %s", (name, href) => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    expect(mocks.navigate).toHaveBeenCalledWith({ href });
  });

  it("offers one swap entry and no row that only opens a list", () => {
    renderSheet();
    expect(rowNames()).toEqual([
      "Add a Puzzle",
      "Log a solve",
      "Find a swap",
      "Messages",
      "Profile",
      "What's new",
      "Help & guides",
      "Docs",
    ]);
  });

  it("names the swap row in Dutch", () => {
    renderSheet("nl");
    expect(screen.getByRole("button", { name: /Zoek een ruil/ })).toBeTruthy();
  });

  it("shows the unread messages on the Messages row and in its name", () => {
    renderSheet("en", { unreadMessages: 3 });
    const row = screen.getByRole("button", { name: /3 unread messages/ });
    expect(row.textContent).toContain("Messages");
    const pill = row.querySelector("[aria-hidden]:not(svg)");
    expect(pill?.textContent).toBe("3");
  });

  it("offers the theme and language choices below the actions", () => {
    renderSheet();
    const lastRow = screen.getByRole("button", { name: /Help & guides/ });
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

describe("MobileQuickSheet help entry (UX-91)", () => {
  it("lists Help & guides right after What's new", () => {
    renderSheet();
    const names = rowNames();
    expect(names[names.indexOf("What's new") + 1]).toBe("Help & guides");
  });

  it("closes the sheet and opens the Guides tab of What's new", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^Help & guides/ }));
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({
      href: "/whats-new?tab=guides",
    });
  });

  it("keeps the unread count on What's new only", () => {
    renderSheet("en", { whatsNewCount: 2 });
    expect(
      screen.getByRole("button", { name: /^Help & guides/ }).textContent,
    ).not.toMatch(/2/);
    expect(
      screen.getByRole("button", { name: /^What's new/ }).textContent,
    ).toMatch(/2/);
  });

  it("speaks Dutch", () => {
    renderSheet("nl");
    expect(rowNames()).toContain("Hulp en rondleidingen");
  });

  // A1: the written guides, under the tours.
  it("lists the docs right after Help & guides, in both languages", () => {
    renderSheet();
    const names = rowNames();
    expect(names[names.indexOf("Help & guides") + 1]).toBe("Docs");
    cleanup();
    renderSheet("nl");
    const dutch = rowNames();
    expect(dutch[dutch.indexOf("Hulp en rondleidingen") + 1]).toBe(
      "Documentatie",
    );
  });

  // An open book is the Library tab's icon.
  it("draws Docs as a page, not as Library's open book", () => {
    renderSheet();
    const icon = screen
      .getByRole("button", { name: /^Docs/ })
      .querySelector("svg")
      ?.getAttribute("class");
    expect(icon).toContain("lucide-file-text");
    expect(icon).not.toContain("lucide-book-open");
  });
});

// The sheet has to be closable without seeing the backdrop: a screen reader doesn't expose it, so
// without a button the only way out was to pick an item.
describe("MobileQuickSheet close button", () => {
  it("offers a named close button that closes the sheet", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: en.common.close }));
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog").className).not.toContain(
      "[&>button]:hidden",
    );
  });

  it("shows its title in place of a drag handle that never dragged", () => {
    renderSheet();
    const title = screen.getByRole("heading", {
      name: en.shell.search.quickActions,
    });
    expect(title.className).not.toContain("sr-only");
    expect(screen.getByRole("dialog").querySelector(".bg-border")).toBeNull();
  });
});
