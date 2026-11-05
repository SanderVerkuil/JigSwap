// @vitest-environment happy-dom
// UX-57: the public header's language pill shows an SVG flag with the language code (an emoji
// flag renders as the letters "US" on Windows), is named with the current language and the visible
// code (WCAG 2.5.3), and its menu marks the current language as a checked radio with each name
// tagged in its own language. The nav folds into the burger before it can push the CTA off the bar.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MarketingHeader } from "./header";

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
vi.mock("@/components/marketing/wordmark", () => ({
  Wordmark: ({ textClassName }: { textClassName?: string }) => (
    <span data-testid="wordmark-name" className={textClassName} />
  ),
}));

// Signed out: the header's auth-gated actions render their Unauthenticated branch.
vi.mock("convex/react", () => ({
  Authenticated: () => null,
  Unauthenticated: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@/lib/i18n", () => ({
  setLocale: vi.fn(),
  clearIntlCache: vi.fn(),
}));

afterEach(cleanup);

const renderHeader = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MarketingHeader />
    </IntlProvider>,
  );

const menuToggle = () =>
  screen.getByRole("button", { name: /^(Open|Close) menu$/ });

describe("MarketingHeader language pill", () => {
  it("shows the SVG flag and code of the current language, no emoji", () => {
    renderHeader("nl");
    const trigger = screen.getByRole("button", {
      name: "Taal wijzigen: Nederlands, NL",
    });
    expect(trigger.textContent).toBe("NL");
    expect(trigger.querySelector("svg[viewBox='0 0 60 45']")).toBeTruthy();
    expect(trigger.textContent).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("checks the current language and tags each name with its language", async () => {
    renderHeader();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Switch language: English, EN" }),
      { button: 0, ctrlKey: false },
    );
    const items = await screen.findAllByRole("menuitemradio");
    expect(
      items.map((item) => [
        item.textContent,
        item.getAttribute("aria-checked"),
        item.getAttribute("lang"),
      ]),
    ).toEqual([
      ["English", "true", "en"],
      ["Nederlands", "false", "nl"],
    ]);
  });
});

describe("MarketingHeader breakpoints", () => {
  const classesOf = (element: Element | null) =>
    (element?.getAttribute("class") ?? "").split(/\s+/);

  // The full Dutch bar needs about 1,185px (nav, language pill, theme, log in and CTA), so below
  // that width the nav would push the CTA past the clipped right edge.
  it("folds the nav into the burger where the full bar stops fitting", () => {
    renderHeader("nl");
    expect(classesOf(screen.getByRole("navigation"))).toEqual(
      expect.arrayContaining(["hidden", "min-[1200px]:flex"]),
    );
    expect(
      classesOf(screen.getByRole("button", { name: "Menu openen" })),
    ).toContain("min-[1200px]:hidden");
  });

  // At 360px the Dutch bar was measured to fit: wordmark 16-134, CTA 152-296, toggle 304-344.
  it("keeps the product name in the bar down to 360px", () => {
    renderHeader("nl");
    expect(screen.getByTestId("wordmark-name").className).toBe(
      "max-[360px]:hidden",
    );
  });

  it("opens the burger menu at every width the burger shows", () => {
    renderHeader("nl");
    fireEvent.click(screen.getByRole("button", { name: "Menu openen" }));
    const closeMenu = screen.getByRole("button", { name: "Menu sluiten" });
    const panel = closeMenu.closest("header")?.lastElementChild ?? null;
    expect(classesOf(panel)).toContain("min-[1200px]:hidden");
    expect(panel?.querySelector("a[href='/how-it-works']")).toBeTruthy();
  });
});

describe("MarketingHeader mobile menu", () => {
  it("announces whether the menu is open and which panel it controls", () => {
    renderHeader();
    const toggle = menuToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("mk-mobile-nav");
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("navigation", { name: "Menu" });
    expect(panel.id).toBe("mk-mobile-nav");
    expect(
      within(panel).getByRole("link", { name: "How it works" }),
    ).toBeTruthy();
  });

  it("closes on Escape and hands focus back to the toggle", () => {
    renderHeader();
    fireEvent.click(menuToggle());
    const firstLink = within(
      screen.getByRole("navigation", { name: "Menu" }),
    ).getByRole("link", { name: "How it works" });
    act(() => firstLink.focus());

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menuToggle());
  });

  it("keeps the sign-up CTA in the bar on every width", () => {
    renderHeader();
    const cta = screen.getByRole("link", { name: "Start your shelf" });
    expect(cta.getAttribute("href")).toBe("/sign-up");
    // No breakpoint hides it: the bar keeps it next to the menu toggle.
    expect(cta.className.split(/\s+/)).not.toContain("hidden");
  });

  it("offers the language and theme switches inside the menu on phones", () => {
    renderHeader();
    fireEvent.click(menuToggle());
    const panel = screen.getByRole("navigation", { name: "Menu" });
    expect(
      within(panel).getByRole("button", {
        name: "Switch language: English, EN",
      }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "Toggle dark mode" }),
    ).toBeTruthy();
  });

  it("labels the desktop navigation apart from the menu", () => {
    renderHeader();
    const desktopNav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(desktopNav).getByRole("link", { name: "How it works" }),
    ).toBeTruthy();
  });

  // No layout here, so the scrolling itself was measured in a browser (844x390, 320x180). This
  // guards what makes it hold.
  it("scrolls inside the panel, so its last items stay reachable on a short screen", () => {
    renderHeader();
    fireEvent.click(menuToggle());
    expect(
      screen.getByRole("navigation", { name: "Menu" }).className.split(/\s+/),
    ).toEqual(
      expect.arrayContaining([
        "max-h-[calc(100dvh-64px)]",
        "overflow-y-auto",
        "overscroll-contain",
      ]),
    );
  });

  // No layout here either, so the taps were run in a browser (touch emulation at 390 and 820). The
  // menu closes on the press, before the tap's click is aimed: if the panel took up room in the
  // page, the page would jump up under the finger and the click would open something else.
  it("floats over the page, so closing it leaves everything under a tap in place", () => {
    renderHeader();
    fireEvent.click(menuToggle());
    expect(
      screen.getByRole("navigation", { name: "Menu" }).className.split(/\s+/),
    ).toEqual(expect.arrayContaining(["absolute", "inset-x-0", "top-full"]));
  });

  it("closes on a press outside the header, leaving focus where the press put it", () => {
    renderHeader();
    fireEvent.click(menuToggle());

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(document.activeElement).not.toBe(menuToggle());
  });

  it("stays open on a press inside the header", () => {
    renderHeader();
    fireEvent.click(menuToggle());

    fireEvent.pointerDown(screen.getByRole("navigation", { name: "Menu" }));
    fireEvent.pointerDown(screen.getByRole("link", { name: "JigSwap" }));

    expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
  });

  it("stays open while the language menu, in its portal, takes the press", async () => {
    renderHeader();
    fireEvent.click(menuToggle());
    const panel = screen.getByRole("navigation", { name: "Menu" });
    fireEvent.pointerDown(
      within(panel).getByRole("button", {
        name: "Switch language: English, EN",
      }),
      { button: 0, ctrlKey: false },
    );
    const [item] = await screen.findAllByRole("menuitemradio");

    fireEvent.pointerDown(item);

    // The open dropdown hides the rest of the page from assistive technology.
    expect(
      screen.getByRole("navigation", { name: "Menu", hidden: true }),
    ).toBeTruthy();
  });

  it("leaves an Escape that another layer already handled alone", () => {
    renderHeader();
    fireEvent.click(menuToggle());
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
  });
});

// jsdom-style environments have no layout, so the fit itself was measured in a browser (861-1440px,
// EN and NL). This guards what makes it hold: one line per link, one shared breakpoint.
describe("MarketingHeader desktop bar", () => {
  it("never wraps a link, and swaps with the menu at one breakpoint", () => {
    renderHeader();
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toContain("whitespace-nowrap");
    }
    expect(screen.getByRole("link", { name: "Log in" }).className).toContain(
      "whitespace-nowrap",
    );

    const breakpoint = /min-\[(\d+)px\]:flex/.exec(nav.className)?.[1];
    expect(breakpoint).toBeDefined();
    expect(menuToggle().className).toContain(`min-[${breakpoint}px]:hidden`);
    expect(
      screen.getByRole("link", { name: "Start your shelf" }).className,
    ).toContain(`min-[${breakpoint}px]:px-4`);
  });

  it("keeps log in in the bar from 861px, and in the menu only below that", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Log in" }).className).toContain(
      "min-[861px]:inline-flex",
    );

    fireEvent.click(menuToggle());
    const panel = screen.getByRole("navigation", { name: "Menu" });
    expect(
      within(panel).getByRole("link", { name: "Log in" }).className,
    ).toContain("min-[861px]:hidden");
  });
});

describe("MarketingHeader translations", () => {
  it("names the theme toggle in the visitor's language", () => {
    renderHeader("nl");
    expect(
      screen.getByRole("button", { name: "Donkere modus aan/uit" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Toggle dark mode" }),
    ).toBeNull();
  });
});
