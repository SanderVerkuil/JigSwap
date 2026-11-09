// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MarketingFooter } from "./footer";

const consent = vi.hoisted(() => ({ openCookieSettings: vi.fn() }));
vi.mock("@/lib/analytics-consent", () => consent);

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock("convex/react", () => ({ useConvexAuth: () => auth }));

// The footer under a real router at `path`, so its links work out for themselves which is current.
const renderFooter = async (
  locale: "en" | "nl" = "en",
  { path = "/", curtain = false }: { path?: string; curtain?: boolean } = {},
) => {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider
        locale={locale}
        messages={locale === "nl" ? nl : en}
        timeZone="Europe/Amsterdam"
      >
        <Outlet />
        <MarketingFooter curtain={curtain} />
      </IntlProvider>
    ),
  });
  const anyPage = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([anyPage]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  await screen.findByRole("contentinfo");
};

afterEach(cleanup);

describe("MarketingFooter start link", () => {
  afterEach(() => {
    auth.isAuthenticated = false;
  });

  it("invites a visitor to start", async () => {
    await renderFooter();
    expect(
      screen
        .getByRole("link", { name: "Start your shelf" })
        .getAttribute("href"),
    ).toBe("/sign-up");
  });

  it("takes a member to their dashboard, under that name", async () => {
    auth.isAuthenticated = true;
    await renderFooter();
    expect(screen.queryByRole("link", { name: "Start your shelf" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Dashboard" }).getAttribute("href"),
    ).toBe("/dashboard");
  });
});

describe("MarketingFooter touch targets", () => {
  // No layout here, so the size was measured in a browser (34px at 390 and 820, same rhythm as
  // before). These classes are what make it: every link grows on touch while the gap shrinks.
  it("gives every link and the cookie button more height on touch screens", async () => {
    await renderFooter();
    const footer = screen.getByRole("contentinfo");
    const controls = [
      ...within(footer)
        .getAllByRole("link")
        .filter((link) => link.textContent),
      within(footer).getByRole("button", { name: "Cookie settings" }),
    ];
    // The brand link above the columns isn't a list item.
    const listed = controls.filter((el) => el.closest(".flex-col"));
    expect(listed.length).toBeGreaterThan(5);
    for (const el of listed) {
      expect(el.className.split(/\s+/)).toContain("min-h-9");
    }
  });
});

describe("MarketingFooter curtain", () => {
  // Someone scrolling down for the links shouldn't have to pass the big name first, so only the name
  // may be pinned: pinning the board too uncovers it last.
  it("pins the name behind the links, never the links themselves", async () => {
    await renderFooter("en", { curtain: true });
    const footer = screen.getByRole("contentinfo");
    expect(footer.className.split(/\s+/)).not.toContain("sticky");

    const pinned = footer.querySelector(".sticky");
    expect(pinned?.textContent).toBe("JigSwap");
    expect(pinned?.querySelector("a, button")).toBeNull();

    // The links come before the name in the page, so they arrive first.
    const firstLink = within(footer).getAllByRole("link")[0];
    expect(
      firstLink.compareDocumentPosition(pinned as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("MarketingFooter legal links", () => {
  it("points Cookie policy at the cookie section, not the top of the privacy policy", async () => {
    await renderFooter();
    expect(
      screen.getByRole("link", { name: "Cookie policy" }).getAttribute("href"),
    ).toBe("/privacy#p-cookies");
    expect(
      screen.getByRole("link", { name: "Privacy policy" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it("offers Cookie settings, which reopens the cookie banner", async () => {
    await renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(consent.openCookieSettings).toHaveBeenCalledTimes(1);
  });

  it("names Cookie settings in Dutch", async () => {
    await renderFooter("nl");
    expect(
      screen.getByRole("button", { name: "Cookie-instellingen" }),
    ).toBeTruthy();
  });
});

// F19: TanStack marks a link current on every page under it, and ignores the hash, so on the privacy
// policy Cookie policy was current too, and Docs on every docs article.
describe("MarketingFooter current page", () => {
  const current = () =>
    within(screen.getByRole("contentinfo"))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent);

  it("marks only Privacy policy on the privacy policy", async () => {
    await renderFooter("en", { path: "/privacy" });
    expect(current()).toEqual(["Privacy policy"]);
  });

  it("marks Cookie policy at the cookie section", async () => {
    await renderFooter("en", { path: "/privacy#p-cookies" });
    expect(current()).toContain("Cookie policy");
  });

  it("marks no footer link on a docs article", async () => {
    await renderFooter("en", { path: "/docs/getting-started" });
    expect(current()).toEqual([]);
  });
});
