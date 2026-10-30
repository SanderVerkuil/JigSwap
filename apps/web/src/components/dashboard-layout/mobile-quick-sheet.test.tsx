// @vitest-environment happy-dom
// UX-58: every quick-sheet row opens what it promises. "Log a Completion" opens the log flow, not
// the list, and "Find a swap" opens Browse (where swaps start) instead of the exchanges list.
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

vi.mock("@/components/install-app/use-install-app", () => ({
  useInstallMethod: () => null,
  requestInstallTip: vi.fn(),
  runInstallPrompt: vi.fn(),
}));

const renderSheet = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MobileQuickSheet open onOpenChange={() => {}} whatsNewCount={0} />
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
      "Profile",
      "What's new",
    ]);
  });

  it("names the swap row in Dutch", () => {
    renderSheet("nl");
    expect(screen.getByRole("button", { name: /Zoek een ruil/ })).toBeTruthy();
  });
});
