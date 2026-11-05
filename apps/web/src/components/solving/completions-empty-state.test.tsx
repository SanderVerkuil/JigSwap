// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CompletionsEmptyState } from "./completions-empty-state";

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search)}` : to} {...rest}>
      {children}
    </a>
  ),
}));

// An empty completion log says what to do next: log a solve, or mark the puzzles solved before
// joining in the quick start's past-solves step. It doesn't assume the member owns the puzzle.

const renderEmpty = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CompletionsEmptyState />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("CompletionsEmptyState", () => {
  it("offers Log a solve and the past-solves step", () => {
    renderEmpty();
    const log = screen.getByRole("link", { name: "Log a solve" });
    expect(log.getAttribute("href")).toBe("/completions/new");
    // The page-head tour step points here while the page is empty.
    expect(log.getAttribute("data-tour")).toBe("completions-log");
    expect(
      screen
        .getByRole("link", { name: "Mark past solves" })
        .getAttribute("href"),
    ).toBe("/welcome?step=solves");
    expect(screen.getByText(/Already solved some\?/)).toBeDefined();
  });

  it("speaks to members who borrow too", () => {
    renderEmpty();
    expect(screen.queryByText(/one of your puzzles/)).toBeNull();
    expect(screen.getByText(/borrow/)).toBeDefined();
  });

  it("speaks Dutch", () => {
    renderEmpty("nl");
    expect(
      screen.getByRole("link", { name: "Voltooiing vastleggen" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Leg eerdere voltooiingen vast" })
        .getAttribute("href"),
    ).toBe("/welcome?step=solves");
  });
});
