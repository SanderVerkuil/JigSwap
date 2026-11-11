// @vitest-environment happy-dom
import type { DocHeading } from "@/docs/types";
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { OnPageToc } from "./on-page-toc";

const headings: DocHeading[] = [
  { id: "one", text: "One", depth: 2 },
  { id: "two", text: "Two", depth: 2 },
  { id: "three", text: "Three", depth: 3 },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderToc = (variant?: "details") =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      {headings.map((h) => (
        <h2 key={h.id} id={h.id}>
          {h.text}
        </h2>
      ))}
      <OnPageToc headings={headings} variant={variant} />
    </IntlProvider>,
  );

// The folded block is the contents on a phone, and its 23 Messages links measured 29px.
describe("OnPageToc folded block", () => {
  it("gives each entry a 44px row on touch screens", () => {
    const { container } = renderToc("details");
    const links = (
      container.querySelector("details") as HTMLElement
    ).querySelectorAll("a");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.className.split(" ")).toEqual(
        expect.arrayContaining([
          "pointer-coarse:min-h-11",
          "flex",
          "items-center",
        ]),
      );
    }
  });
});

// F14: 6 of Messages' 23 entries slipped out of the rail when current at 1280×720.
describe("OnPageToc rail", () => {
  it("scrolls itself, not the page, to keep the current entry in view", () => {
    // A 100px rail with its entries 200px apart. happy-dom has no layout, so every heading's top
    // is 0 and the last one is current.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const rail = this.closest("aside");
        if (this === rail) {
          return { top: 0, bottom: 100, height: 100 } as DOMRect;
        }
        if (!rail || this.tagName !== "A") return { top: 0 } as DOMRect;
        const links = Array.from(rail.querySelectorAll("a"));
        const top =
          40 + 200 * links.indexOf(this as HTMLAnchorElement) - rail.scrollTop;
        return { top, bottom: top + 30, height: 30 } as DOMRect;
      },
    );
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderToc();
    const rail = screen.getByRole("complementary", { name: "On this page" });
    const current = within(rail).getByRole("link", { current: true });

    expect(current.textContent).toBe("Three");
    expect(current.getBoundingClientRect().bottom).toBe(100 - 24);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
