// @vitest-environment happy-dom
// UX-06: on a phone the hub pages (/library, /community) list their pages as compact ~56px rows
// instead of tall tiles, and the Community hub shows the live counts on Messages (unread) and
// Exchanges (requests waiting for the member's answer): a visual pill below sm, the full count in
// the row's name at every size. From sm up the tile grid is unchanged.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { GroupLanding } from "./group-landing";
import type { ShellGroupKey } from "./route-meta";

const mocks = vi.hoisted(() => ({ unreadMessages: 0, pendingRequests: 0 }));

vi.mock("./nav-counts", () => ({
  useUnreadMessageCount: () => mocks.unreadMessages,
  usePendingRequestCount: () => mocks.pendingRequests,
}));
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
  mocks.unreadMessages = 0;
  mocks.pendingRequests = 0;
});

function renderLanding(group: ShellGroupKey, locale: "en" | "nl" = "en") {
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <GroupLanding group={group} />
    </IntlProvider>,
  );
}

const linkTo = (href: string) => {
  const link = document.querySelector(`a[href="${href}"]`);
  if (!link) throw new Error(`no link to ${href}`);
  return link;
};
const pillOf = (link: Element) => link.querySelector("[aria-hidden]:not(svg)");
const classesOf = (element: Element | null | undefined) =>
  (element?.getAttribute("class") ?? "").split(/\s+/);

describe("GroupLanding", () => {
  it("lays the pages out as compact rows below sm and tiles from sm", () => {
    renderLanding("library");
    const row = linkTo("/my-puzzles");
    const classes = classesOf(row);
    // A row below sm: icon, text and chevron side by side, at least 56px tall.
    expect(classes).toContain("min-h-14");
    expect(classes).toContain("items-center");
    // The tile from sm: stacked, padded as before.
    expect(classes).toContain("sm:flex-col");
    expect(classes).toContain("sm:p-5");
    const description = screen.getByText(en.shell.pages.myPuzzles.description);
    expect(classesOf(description)).toContain("line-clamp-1");
    expect(classesOf(description)).toContain("sm:line-clamp-2");
  });

  it("shows no counts while nothing is waiting", () => {
    renderLanding("community");
    expect(pillOf(linkTo("/messages"))).toBeNull();
    expect(pillOf(linkTo("/trades"))).toBeNull();
  });

  it("shows unread messages and waiting requests on their rows", () => {
    mocks.unreadMessages = 3;
    mocks.pendingRequests = 12;
    renderLanding("community");

    const messages = linkTo("/messages");
    expect(pillOf(messages)?.textContent).toBe("3");
    expect(classesOf(pillOf(messages)?.parentElement)).toContain("sm:hidden");
    expect(messages.textContent).toContain("3 unread messages");

    const exchanges = linkTo("/trades");
    expect(pillOf(exchanges)?.textContent).toBe("9+");
    expect(exchanges.textContent).toContain(
      "12 requests waiting for your reply",
    );

    // Only those two rows carry a count.
    expect(pillOf(linkTo("/circles"))).toBeNull();
  });

  it("names the counts in Dutch", () => {
    mocks.unreadMessages = 1;
    mocks.pendingRequests = 1;
    renderLanding("community", "nl");
    expect(linkTo("/messages").textContent).toContain("1 ongelezen bericht");
    expect(linkTo("/trades").textContent).toContain(
      "1 verzoek wacht op je antwoord",
    );
  });
});
