// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { BorrowedEmptyState } from "./borrowed-empty-state";

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

describe("BorrowedEmptyState", () => {
  it.each([
    ["en", en, "Nothing borrowed", "Browse puzzles"],
    ["nl", nl, "Niets geleend", "Puzzels ontdekken"],
  ] as const)(
    "explains borrowing and links to Browse (%s)",
    (locale, messages, title, action) => {
      render(
        <IntlProvider locale={locale} messages={messages}>
          <BorrowedEmptyState />
        </IntlProvider>,
      );
      expect(screen.getByText(title)).toBeTruthy();
      const link = screen.getByRole("link", { name: action });
      expect(link.getAttribute("href")).toBe("/browse");
    },
  );
});
