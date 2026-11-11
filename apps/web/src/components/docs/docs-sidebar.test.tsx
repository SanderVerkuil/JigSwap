// @vitest-environment happy-dom
import type { DocMeta } from "@/docs/types";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { DocsSidebar } from "./docs-sidebar";

const location = vi.hoisted(() => ({ pathname: "/docs/g/page-2" }));

// The router marks the link to the current page with aria-current="page".
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    to: _to,
    activeProps: _activeProps,
    children,
    ...rest
  }: ComponentProps<"a"> & {
    to: string;
    params: { _splat: string };
    activeProps?: object;
  }) => {
    const href = `/docs/${params._splat}`;
    return (
      <a
        href={href}
        aria-current={href === location.pathname ? "page" : undefined}
        {...rest}
      >
        {children}
      </a>
    );
  },
  useLocation: () => location,
}));

vi.mock("virtual:docs", () => {
  const page = (slug: string, title: string, order = 0): DocMeta => ({
    id: `en/${slug}`,
    locale: "en",
    slug,
    group: "g",
    isIndex: slug === "g",
    frontmatter: { title, order },
  });
  return {
    pages: [
      page("g", "Group"),
      ...Array.from({ length: 20 }, (_, i) =>
        page(`g/page-${i + 1}`, `Page ${i + 1}`, i + 1),
      ),
    ],
  };
});

// The sidebar's box: 300px tall at the top of the window. Its links are 30px rows, 40px apart from
// 100px down its list; happy-dom has no layout of its own.
const BOX_HEIGHT = 300;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const box = document.querySelector<HTMLElement>('[data-testid="box"]');
      if (!box || this === box) {
        return { top: 0, bottom: BOX_HEIGHT, height: BOX_HEIGHT } as DOMRect;
      }
      const links = Array.from(box.querySelectorAll('a[href^="/docs/g/"]'));
      const top = 100 + 40 * links.indexOf(this) - box.scrollTop;
      return { top, bottom: top + 30, height: 30 } as DOMRect;
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sidebar = () => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    <div data-testid="box" style={{ overflowY: "auto" }}>
      <DocsSidebar onOpenSearch={() => {}} />
    </div>
  </IntlProvider>
);

const box = () => screen.getByTestId("box");
const current = () =>
  screen.getByRole("link", { current: "page" }).getBoundingClientRect();

// The sidebar opened scrolled to the top, so a page far down the list had its link off screen
// (8 of 22 at 1440×900, and 1158px down an 844px phone menu).
describe("DocsSidebar keeps the current page in view", () => {
  it("scrolls its own box to show the current link a third of the way down", () => {
    location.pathname = "/docs/g/page-15";
    render(sidebar());

    expect(box().scrollTop).toBe(560);
    expect(current().top).toBe(BOX_HEIGHT / 3);
    // Not by moving the page.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves a current link that is already in view where it is", () => {
    location.pathname = "/docs/g/page-2";
    render(sidebar());

    expect(box().scrollTop).toBe(0);
  });

  it("follows the page as the reader moves on", () => {
    location.pathname = "/docs/g/page-2";
    const { rerender } = render(sidebar());
    expect(box().scrollTop).toBe(0);

    location.pathname = "/docs/g/page-20";
    rerender(sidebar());

    expect(current().top).toBe(BOX_HEIGHT / 3);
  });
});
