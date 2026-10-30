// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ExchangesEmptyState } from "./exchanges-empty-state";

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

afterEach(cleanup);

const renderEmpty = (
  props: Partial<ComponentProps<typeof ExchangesEmptyState>> = {},
  locale: "en" | "nl" = "en",
) => {
  const onShowAllStatuses = vi.fn();
  render(
    <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
      <ExchangesEmptyState
        tab="all"
        onShowAllStatuses={onShowAllStatuses}
        {...props}
      />
    </IntlProvider>,
  );
  return { onShowAllStatuses };
};

const linkTo = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("ExchangesEmptyState", () => {
  it("explains an empty exchange list and links to Browse", () => {
    renderEmpty();
    expect(screen.getByText("No exchanges yet")).toBeTruthy();
    expect(linkTo("Browse puzzles")).toBe("/browse");
  });

  it("says what Incoming is for and where to offer puzzles", () => {
    renderEmpty({ tab: "incoming" });
    expect(screen.getByText("No requests for your puzzles")).toBeTruthy();
    expect(linkTo("Go to My Puzzles")).toBe("/my-puzzles");
  });

  it("sends an empty Outgoing tab to Browse", () => {
    renderEmpty({ tab: "outgoing" });
    expect(screen.getByText("No requests sent yet")).toBeTruthy();
    expect(linkTo("Browse puzzles")).toBe("/browse");
  });

  it("names the status filter that hides everything and offers to clear it", () => {
    const { onShowAllStatuses } = renderEmpty({
      tab: "incoming",
      status: "completed",
    });
    expect(
      screen.getByText("No exchanges with status “Completed”"),
    ).toBeTruthy();
    expect(screen.queryByText("No requests for your puzzles")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all statuses" }));
    expect(onShowAllStatuses).toHaveBeenCalledOnce();
  });

  it("is translated (nl)", () => {
    renderEmpty({ status: "completed" }, "nl");
    expect(
      screen.getByText("Geen uitwisselingen met status “Afgerond”"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Alle statussen tonen" }),
    ).toBeTruthy();
  });
});
