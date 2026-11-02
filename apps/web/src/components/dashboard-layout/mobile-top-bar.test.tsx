// @vitest-environment happy-dom
// UX-06: Messages is one tap away on a phone. The top bar carries a Messages icon with the unread
// count as an aria-hidden badge; the count is in the link's name.
// UX-160: the dashboard lockup is the mark-only glyph next to the wordmark text, so it reads
// "JigSwap" once (the stacked logo already spells it out underneath the mark).
// UX-59: the ‹ chevron is a real Back. It is hidden on the pages the tabs open; elsewhere it goes
// back through history when the previous entry is in the app, and up to the section hub otherwise.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MobileTopBar } from "./mobile-top-bar";
import {
  PageHeaderSlotProvider,
  usePageHeader,
  type PageHeaderContent,
} from "./page-header-slot";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  unreadMessages: 0,
  canGoBack: false,
  back: vi.fn<() => void>(),
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
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: {
      canGoBack: () => mocks.canGoBack,
      back: mocks.back,
      subscribe: () => () => {},
    },
  }),
}));
vi.mock("./nav-counts", () => ({
  useUnreadMessageCount: () => mocks.unreadMessages,
}));
vi.mock("./shell-user-button", () => ({ ShellUserButton: () => null }));
vi.mock("@/compat/image", () => ({
  Image: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    activeOptions,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    activeOptions?: { exact?: boolean };
  }) => (
    <a href={href} data-exact-active={activeOptions?.exact} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/dashboard";
  mocks.unreadMessages = 0;
  mocks.canGoBack = false;
  mocks.back.mockReset();
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

  it("caps the badge but not the name, which also carries the visible 9+", () => {
    mocks.unreadMessages = 12;
    renderBar("/dashboard");
    const link = screen.getByRole("link", {
      name: "Messages, 9+, 12 unread messages",
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

  it("shows the current page in the icon's colour too, not only to assistive tech", () => {
    renderBar("/messages");
    expect(
      screen.getByRole("link", { name: "Messages" }).getAttribute("class"),
    ).toContain("aria-[current=page]:text-primary-text");
  });

  it("names the count in Dutch", () => {
    mocks.unreadMessages = 1;
    renderBar("/dashboard", "nl");
    expect(
      screen.getByRole("link", { name: "Berichten, 1 ongelezen bericht" }),
    ).toBeTruthy();
  });
});

describe("MobileTopBar notifications bell", () => {
  const bell = () => screen.getByRole("link", { name: en.notifications.bell });

  it("is the current page on the notifications page, in name and colour", () => {
    renderBar("/notifications");
    expect(bell().getAttribute("aria-current")).toBe("page");
    expect(bell().getAttribute("class")).toContain(
      "aria-[current=page]:text-primary-text",
    );
  });

  it("isn't the current page elsewhere, nor below it on preferences", () => {
    renderBar("/dashboard");
    expect(bell().getAttribute("aria-current")).toBeNull();
    cleanup();
    renderBar("/notifications/preferences");
    expect(bell().getAttribute("aria-current")).toBeNull();
    // The router would mark it current on a child route otherwise.
    expect(bell().getAttribute("data-exact-active")).toBe("true");
  });
});

describe("MobileTopBar back chevron", () => {
  const backLink = () => screen.queryByRole("link", { name: /^Back/ });

  it.each(["/dashboard", "/library", "/trades", "/community"])(
    "shows no back chevron on the tab root %s",
    (pathname) => {
      mocks.canGoBack = true;
      renderBar(pathname);
      expect(backLink()).toBeNull();
    },
  );

  it("goes up to the section hub when there is no in-app page to go back to", () => {
    renderBar("/my-puzzles");
    const link = screen.getByRole("link", { name: "Back to My Library" });
    expect(link.getAttribute("href")).toBe("/library");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(false);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("goes back through history when the previous page is in the app", () => {
    mocks.canGoBack = true;
    renderBar("/my-puzzles");
    const link = screen.getByRole("link", { name: "Back" });
    // The hub stays the link target for a new tab or a no-JS click.
    expect(link.getAttribute("href")).toBe("/library");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(mocks.back).toHaveBeenCalledOnce();
  });

  it("leaves a modified click to the link (open the hub in a new tab)", () => {
    mocks.canGoBack = true;
    renderBar("/my-puzzles");
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    fireEvent(screen.getByRole("link", { name: "Back" }), click);
    expect(click.defaultPrevented).toBe(false);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  // Notification preferences sits in no nav group, and in an installed app on iOS there is no
  // browser back button.
  it("goes up to the parent page on a route outside the nav groups", () => {
    renderBar("/notifications/preferences");
    const link = screen.getByRole("link", { name: "Back to Notifications" });
    expect(link.getAttribute("href")).toBe("/notifications");
    // The router would mark a link to the parent as current on its child otherwise.
    expect(link.getAttribute("data-exact-active")).toBe("true");
  });

  it("goes back through history there too", () => {
    mocks.canGoBack = true;
    renderBar("/notifications/preferences");
    fireEvent.click(screen.getByRole("link", { name: "Back" }));
    expect(mocks.back).toHaveBeenCalledOnce();
  });

  it.each(["/notifications", "/profile", "/whats-new"])(
    "shows no back chevron on the top-level page %s",
    (pathname) => {
      mocks.canGoBack = true;
      renderBar(pathname);
      expect(backLink()).toBeNull();
    },
  );

  it("names the generic Back in Dutch", () => {
    mocks.canGoBack = true;
    renderBar("/my-puzzles", "nl");
    expect(screen.getByRole("link", { name: "Terug" })).toBeTruthy();
  });
});

describe("MobileTopBar lockup", () => {
  it("names the home link JigSwap once, with a decorative mark-only glyph", () => {
    renderBar("/dashboard");
    const home = screen.getByRole("link", { name: "JigSwap" });
    expect(home.getAttribute("href")).toBe("/dashboard");
    const mark = home.querySelector("img");
    expect(mark?.getAttribute("alt")).toBe("");
    // The stacked header-icon lockup has "JigSwap" baked into the image.
    expect(mark?.getAttribute("src")).toContain(
      "marketing/assets/icon-96.webp",
    );
  });
});

// UX-06/UX-59: four icons and a back chevron leave about 126px at 360px, so on phones the title
// is a little smaller and may take two lines before it truncates; the controls close up too.
describe("MobileTopBar title", () => {
  it("wraps onto two smaller lines on phones instead of truncating", () => {
    renderBar("/completions/new");
    const classes = (
      screen
        .getByText(en.shell.pages.completionNew.title)
        .getAttribute("class") ?? ""
    ).split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "max-sm:line-clamp-2",
        "max-sm:whitespace-normal",
        "max-sm:text-base",
        "max-sm:leading-snug",
      ]),
    );
  });

  it("closes up the controls on phones, keeping every target at 44px", () => {
    renderBar("/completions/new");
    const row = screen.getByText(en.shell.pages.completionNew.title)
      .parentElement?.parentElement;
    expect(row?.getAttribute("class")?.split(/\s+/)).toContain("max-sm:gap-0");
    expect(
      screen.getByRole("link", { name: "Messages" }).getAttribute("class"),
    ).toContain("size-11");
  });
});

function Publish({ content }: { content: PageHeaderContent }) {
  usePageHeader(() => content, [content]);
  return null;
}

const renderPublished = (content: PageHeaderContent) => {
  mocks.pathname = "/puzzles/puzzle_1";
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PageHeaderSlotProvider>
        <Publish content={content} />
        <MobileTopBar onOpenPalette={() => {}} />
      </PageHeaderSlotProvider>
    </IntlProvider>,
  );
};

describe("MobileTopBar published title", () => {
  it("shows a published title as plain text: the page's h1 lives in main", () => {
    renderPublished({ title: "Café" });

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Café")).toBeTruthy();
  });

  it("shows the title as plain text when the page renders it as its own heading", () => {
    renderPublished({ title: "Café", titleInContent: true });

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Café")).toBeTruthy();
  });
});
