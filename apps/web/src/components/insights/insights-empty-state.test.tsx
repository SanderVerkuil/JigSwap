// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { InsightsEmptyState } from "./insights-empty-state";

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

// Insights without a finished solve says what to do instead of opening on a wall of zeros: log a
// solve, or set a goal to aim for.

const renderEmpty = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <InsightsEmptyState />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("InsightsEmptyState", () => {
  it("offers Log a solve and Set a goal", () => {
    renderEmpty();
    expect(screen.getByText("No finished solves yet")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Log a solve" }).getAttribute("href"),
    ).toBe("/completions/new");
    expect(
      screen.getByRole("link", { name: "Set a goal" }).getAttribute("href"),
    ).toBe("/goals");
  });

  it("speaks Dutch", () => {
    renderEmpty("nl");
    expect(screen.getByText("Nog geen voltooiingen")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Voltooiing vastleggen" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Doel stellen" })).toBeDefined();
  });
});
