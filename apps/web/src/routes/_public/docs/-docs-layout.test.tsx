// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./route";

const location = vi.hoisted(() => ({ pathname: "/docs/getting-started" }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
  }),
  // Follows a plain click itself, like the router's Link, so happy-dom doesn't navigate the window.
  Link: ({
    children,
    to: _to,
    params,
    activeProps: _activeProps,
    onClick,
    ...rest
  }: ComponentProps<"a"> & {
    to: string;
    params: { _splat: string };
    activeProps?: object;
  }) => (
    <a
      href={`/docs/${params._splat}`}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  Outlet: () => <button type="button">In the page</button>,
  useLocation: () => location,
  useNavigate: () => vi.fn(),
}));

vi.mock("virtual:docs", () => ({
  pages: [
    {
      slug: "getting-started",
      group: "getting-started",
      groupTitle: "Getting started",
      isIndex: true,
      locale: "en",
      frontmatter: {
        title: "Getting started",
        summary: "Start here",
        order: 1,
      },
      html: "<p>Start here</p>",
      text: "Start here",
      headings: [],
    },
    {
      slug: "getting-started/first",
      group: "getting-started",
      isIndex: false,
      locale: "en",
      frontmatter: { title: "First steps", order: 1 },
    },
  ],
}));

const Layout = (Route as unknown as { options: { component: ComponentType } })
  .options.component;

const renderLayout = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Layout />
    </IntlProvider>,
  );

const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });

// Focus and click: what a keyboard press on the control does.
const activate = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

const dialog = () => screen.queryByRole("dialog");

// Radix hands focus back on the task after an overlay unmounts.
const radixFocusReturn = () => new Promise((done) => setTimeout(done, 10));

const START_PATH = window.location.pathname;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, "", START_PATH);
});

describe("docs overlays hand focus back", () => {
  it("returns from search to the control that opened it", async () => {
    renderLayout();
    const opener = screen.getByRole("button", { name: "Search documentation" });

    activate(opener);
    expect(dialog()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).not.toBe(opener));

    pressEscape();

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("returns from search opened with the keyboard shortcut to where focus was", async () => {
    renderLayout();
    const inPage = screen.getByRole("button", { name: "In the page" });
    inPage.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(dialog()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).not.toBe(inPage));

    pressEscape();

    await waitFor(() => expect(document.activeElement).toBe(inPage));
  });

  it("doesn't jump back to an earlier opener when nothing had focus", async () => {
    renderLayout();
    activate(screen.getByRole("button", { name: "Search documentation" }));
    pressEscape();
    await waitFor(() => expect(dialog()).toBeNull());
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(dialog()).toBeTruthy();
    pressEscape();

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(document.body));
  });

  it("returns from the navigation sheet to the docs bar's button", async () => {
    renderLayout();
    const opener = screen.getByRole("button", { name: /^Docs \(/ });

    activate(opener);
    expect(dialog()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).not.toBe(opener));

    pressEscape();

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("returns to the docs bar's button when the sheet handed over to search", async () => {
    renderLayout();
    const opener = screen.getByRole("button", { name: /^Docs \(/ });

    activate(opener);
    const sheet = dialog() as HTMLElement;
    const searchInSheet = Array.from(sheet.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(en.marketing.docs.searchTrigger),
    ) as HTMLElement;
    activate(searchInSheet);

    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain(
        en.marketing.docs.searchTitle,
      ),
    );

    pressEscape();

    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  // The route change moves focus to the new page's main content. Handing it back to the opener
  // afterwards left a search pick on the sidebar's search button, 29 Tabs from the article.
  it("leaves focus to the new page when search closed on its way there", async () => {
    renderLayout();
    const opener = screen.getByRole("button", { name: "Search documentation" });
    activate(opener);
    await waitFor(() => expect(document.activeElement).not.toBe(opener));
    const refocus = vi.spyOn(opener, "focus");

    // What a pick does: the router moves to the page as the dialog closes.
    window.history.pushState({}, "", "/docs/getting-started/first");
    pressEscape();

    await waitFor(() => expect(dialog()).toBeNull());
    await radixFocusReturn();
    expect(refocus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(opener);
  });

  it("leaves focus to the new page when a link in the sheet led there", async () => {
    renderLayout();
    const opener = screen.getByRole("button", { name: /^Docs \(/ });
    activate(opener);
    const sheet = dialog() as HTMLElement;
    const refocus = vi.spyOn(opener, "focus");

    window.history.pushState({}, "", "/docs/getting-started/first");
    fireEvent.click(within(sheet).getByRole("link", { name: "First steps" }));

    await waitFor(() => expect(dialog()).toBeNull());
    await radixFocusReturn();
    expect(refocus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(opener);
  });
});

describe("docs navigation sheet", () => {
  // Any tap inside the sheet closed it, so folding a group shut the whole menu.
  it("stays open while a group folds, and closes when a link is followed", async () => {
    renderLayout();
    activate(screen.getByRole("button", { name: /^Docs \(/ }));
    const sheet = dialog() as HTMLElement;
    const group = within(sheet).getByRole("button", {
      name: "Getting started",
    });

    fireEvent.click(group);
    expect(within(sheet).queryByRole("link", { name: "First steps" })).toBe(
      null,
    );
    fireEvent.click(group);
    expect(dialog()).toBe(sheet);

    fireEvent.click(within(sheet).getByRole("link", { name: "First steps" }));
    await waitFor(() => expect(dialog()).toBeNull());
  });
});

// F20: from 861 to 1279px neither the rail beside the article nor the phone Docs bar shows, so a
// long article's contents, folded in under its title, were out of reach from further down.
describe("docs sidebar", () => {
  it("keeps the way back to the folded contents in reach where the Docs bar is hidden", () => {
    const contents = document.createElement("details");
    contents.id = "on-this-page";
    document.body.append(contents);
    renderLayout();

    const sidebar = screen.getByRole("navigation", {
      name: en.marketing.docs.navLabel,
    });
    const link = within(sidebar).getByRole("link", { name: "On this page" });
    expect(link.getAttribute("href")).toBe("#on-this-page");
    // Only between the Docs bar (below 861px) and the rail (from 1280px), and only on a page
    // that has contents to jump to.
    expect(link.className.split(" ")).toEqual(
      expect.arrayContaining([
        "hidden",
        "min-[861px]:max-[1280px]:flex",
        "[body:not(:has(#on-this-page))_&]:hidden",
      ]),
    );
    fireEvent.click(link);
    expect(contents.open).toBe(true);
    contents.remove();
  });

  // They measured 33px; DESIGN.md asks 44px on touch.
  it("gives each article link a 44px row on touch screens", () => {
    renderLayout();
    const sidebar = screen.getByRole("navigation", {
      name: en.marketing.docs.navLabel,
    });
    const link = within(sidebar).getByRole("link", { name: "First steps" });
    expect(link.className.split(" ")).toEqual(
      expect.arrayContaining([
        "pointer-coarse:min-h-11",
        "flex",
        "items-center",
      ]),
    );
  });
});
