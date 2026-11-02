// @vitest-environment happy-dom
// UX-06: on a phone the hub pages (/library, /community) list their pages as compact rows
// instead of tall tiles, and the Community hub shows the live counts on Messages (unread) and
// Exchanges (requests waiting for the member's answer): a visual pill below sm, the full count in
// the row's name at every size. From sm up the tile grid is unchanged.
// UX-146: the admin hub's tiles carry the work waiting in their queues (`counts`), a pill at every
// size, announced with the title.
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

function renderLanding(
  group: ShellGroupKey,
  locale: "en" | "nl" = "en",
  counts?: Parameters<typeof GroupLanding>[0]["counts"],
) {
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <GroupLanding group={group} counts={counts} />
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
    // Two lines at every size: the description is what tells Browse from the catalogue.
    expect(classesOf(description)).toContain("line-clamp-2");
    expect(classesOf(description)).not.toContain("line-clamp-1");
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

describe("GroupLanding counts", () => {
  it("shows the work waiting behind a tile as a pill, announced with its title (en/nl)", () => {
    renderLanding("admin", "en", {
      adminModeration: { count: 50, capped: true },
      adminContact: { count: 3, capped: false },
    });
    const moderation = linkTo("/admin/moderation");
    expect(pillOf(moderation)?.textContent).toBe("50+");
    expect(moderation.querySelector(".sr-only")?.textContent).toBe(
      ", 50 or more waiting",
    );
    const contact = linkTo("/admin/contact");
    expect(pillOf(contact)?.textContent).toBe("3");
    expect(contact.querySelector(".sr-only")?.textContent).toBe(", 3 waiting");
    // Unlike the phone-only live counts, this pill shows at every size: in the row below sm,
    // beside the icon chip from sm.
    expect(classesOf(pillOf(contact))).not.toContain("sm:hidden");
    expect(classesOf(pillOf(contact)?.parentElement)).not.toContain(
      "sm:hidden",
    );
    expect(classesOf(pillOf(contact))).toContain("sm:absolute");
    expect(classesOf(contact)).toContain("relative");
    cleanup();

    renderLanding("admin", "nl", {
      adminContact: { count: 3, capped: false },
    });
    expect(
      linkTo("/admin/contact").querySelector(".sr-only")?.textContent,
    ).toBe(", 3 te behandelen");
  });

  it("shows nothing for an empty queue, an unknown count or a tile without a queue", () => {
    renderLanding("admin", "en", {
      adminPuzzles: { count: 0, capped: false },
    });
    for (const href of [
      "/admin/puzzles",
      "/admin/moderation",
      "/admin/users",
    ]) {
      expect(pillOf(linkTo(href))).toBeNull();
      expect(linkTo(href).querySelector(".sr-only")).toBeNull();
    }
  });

  it("a group rendered without counts is unchanged", () => {
    renderLanding("library");
    expect(document.querySelectorAll("a").length).toBeGreaterThan(0);
    expect(document.querySelector(".sr-only")).toBeNull();
  });
});
