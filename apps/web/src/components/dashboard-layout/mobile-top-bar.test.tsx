// @vitest-environment happy-dom
// UX-06: Messages is one tap away on a phone. The top bar carries a Messages icon with the unread
// count as an aria-hidden badge; the count is in the link's name.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MobileTopBar } from "./mobile-top-bar";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  unreadMessages: 0,
}));

vi.mock("@/compat/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: null }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
}));
vi.mock("./nav-counts", () => ({
  useUnreadMessageCount: () => mocks.unreadMessages,
}));
vi.mock("./shell-user-button", () => ({ ShellUserButton: () => null }));
vi.mock("@/compat/image", () => ({ Image: () => null }));
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

afterEach(() => {
  cleanup();
  mocks.pathname = "/dashboard";
  mocks.unreadMessages = 0;
});

function renderBar(pathname: string, locale: "en" | "nl" = "en") {
  mocks.pathname = pathname;
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MobileTopBar onOpenPalette={() => {}} />
    </IntlProvider>,
  );
}

describe("MobileTopBar Messages entry", () => {
  it("links to Messages from every page", () => {
    renderBar("/my-puzzles");
    const link = screen.getByRole("link", { name: "Messages" });
    expect(link.getAttribute("href")).toBe("/messages");
    expect(link.querySelector("[aria-hidden]:not(svg)")).toBeNull();
  });

  it("puts the unread count in the link's name and an aria-hidden badge", () => {
    mocks.unreadMessages = 3;
    renderBar("/dashboard");
    const link = screen.getByRole("link", {
      name: "Messages, 3 unread messages",
    });
    expect(link.querySelector("[aria-hidden]:not(svg)")?.textContent).toBe("3");
  });

  it("caps the badge but not the name", () => {
    mocks.unreadMessages = 12;
    renderBar("/dashboard");
    const link = screen.getByRole("link", {
      name: "Messages, 12 unread messages",
    });
    expect(link.querySelector("[aria-hidden]:not(svg)")?.textContent).toBe(
      "9+",
    );
  });

  it("marks the link as the current page on the inbox", () => {
    renderBar("/messages");
    expect(
      screen
        .getByRole("link", { name: "Messages" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("names the count in Dutch", () => {
    mocks.unreadMessages = 1;
    renderBar("/dashboard", "nl");
    expect(
      screen.getByRole("link", { name: "Berichten, 1 ongelezen bericht" }),
    ).toBeTruthy();
  });
});
