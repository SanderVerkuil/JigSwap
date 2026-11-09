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
  Link: ({ children, ...rest }: ComponentProps<"a">) => (
    <a {...rest}>{children}</a>
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

afterEach(cleanup);

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
});
