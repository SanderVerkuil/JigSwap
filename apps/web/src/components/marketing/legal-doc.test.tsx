// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { LegalDoc, type LegalSection } from "./legal-doc";

afterEach(cleanup);

describe("LegalDoc", () => {
  it("renders a section's action inside that section, after its text", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <LegalDoc
          updated="Last updated: today"
          intro="Intro"
          sections={[
            {
              id: "p-cookies",
              heading: "Cookies",
              blocks: [{ type: "p", text: "How we use cookies." }],
              action: <button type="button">Change cookie settings</button>,
            },
            {
              id: "p-children",
              heading: "Children",
              blocks: [{ type: "p", text: "Not for children." }],
            },
          ]}
        />
      </IntlProvider>,
    );

    const cookies = document.getElementById("p-cookies");
    expect(cookies).toBeTruthy();
    const action = within(cookies as HTMLElement).getByRole("button", {
      name: "Change cookie settings",
    });
    const text = within(cookies as HTMLElement).getByText(
      "How we use cookies.",
    );
    expect(
      text.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Change cookie settings" }),
    ).toHaveLength(1);
  });
});

const sections: LegalSection[] = [
  { id: "p-who", heading: "Who we are", blocks: [{ type: "p", text: "Us." }] },
  {
    id: "p-cookies",
    heading: "Cookies",
    blocks: [{ type: "p", text: "Crumbs." }],
  },
];

const renderDoc = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <LegalDoc updated="Updated today" intro="Intro." sections={sections} />
    </IntlProvider>,
  );

const hrefs = (root: HTMLElement) =>
  within(root)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));

describe("LegalDoc contents", () => {
  it("links every section by its hash, so a section can be shared and opened directly", () => {
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    expect(hrefs(sideNav)).toEqual(["#p-who", "#p-cookies"]);
    expect(within(sideNav).queryByRole("button")).toBeNull();
  });

  it("marks the section being read as the current one", () => {
    // The first section's top has reached the top of the window, the second is further down.
    const tops: Record<string, number> = { "p-who": 90, "p-cookies": 600 };
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return { top: tops[this.id] ?? 0 } as DOMRect;
      });
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    const links = within(sideNav).getAllByRole("link");
    expect(links[0].getAttribute("aria-current")).toBe("true");
    expect(links[1].hasAttribute("aria-current")).toBe(false);
    rect.mockRestore();
  });

  // F18: the jump parks a short section's heading where the next one's sits close below it, which
  // used to light the next section instead.
  it("marks a section picked from the list as current straight away", () => {
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    const links = within(sideNav).getAllByRole("link");
    fireEvent.click(links[0]);
    expect(links[0].getAttribute("aria-current")).toBe("true");
    expect(links[1].hasAttribute("aria-current")).toBe(false);
  });

  // With a modifier the link opens in a new tab or window and this page doesn't move.
  it("leaves the current section alone when a link opens elsewhere", () => {
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    const links = within(sideNav).getAllByRole("link");
    // happy-dom has no layout, so every top is 0 and the last section is the current one.
    expect(links[1].getAttribute("aria-current")).toBe("true");
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      fireEvent.click(links[0], { [modifier]: true });
      expect(links[0].hasAttribute("aria-current")).toBe(false);
    }
    fireEvent.click(links[0]);
    expect(links[0].getAttribute("aria-current")).toBe("true");
  });

  it("offers the same list as a collapsible Contents block for narrow screens", () => {
    const { container } = renderDoc();
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("Contents");
    expect(hrefs(details as HTMLElement)).toEqual(["#p-who", "#p-cookies"]);
  });

  // F20: on a phone the Contents block is only at the top of a page some 19,000px long.
  it("ends each section with a way back to the contents on narrow screens, opening them", () => {
    const { container } = renderDoc();
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.id).toBe("contents");
    for (const { id } of sections) {
      const back = within(document.getElementById(id) as HTMLElement).getByRole(
        "link",
        { name: "Back to contents" },
      );
      expect(back.getAttribute("href")).toBe("#contents");
      // Only where the folded Contents block shows.
      expect(back.className).toContain("min-[901px]:hidden");
    }
    expect(details.open).toBe(false);
    fireEvent.click(
      within(document.getElementById("p-cookies") as HTMLElement).getByRole(
        "link",
        { name: "Back to contents" },
      ),
    );
    expect(details.open).toBe(true);
  });

  // A contents link is a plain jump to its hash, so nothing animates for a member who asked for
  // reduced motion (UX-161).
  it("jumps without a programmatic scroll", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    fireEvent.click(within(sideNav).getAllByRole("link")[1]);
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});

describe("LegalDoc sections", () => {
  // F12: Young Serif's old-style figures make "11." read as "II.".
  it("numbers the section headings in lining figures", () => {
    renderDoc();
    for (const heading of screen.getAllByRole("heading", { level: 2 })) {
      expect(heading.className).toContain("lining-nums");
    }
  });

  // F11/F16: the page's 80px scroll-padding clears the header; the section adds 10px, so an anchor
  // still lands 90px down without counting the header twice.
  it("lands a linked section 10px below what the page keeps clear for the header", () => {
    renderDoc();
    for (const { id } of sections) {
      const section = document.getElementById(id) as HTMLElement;
      expect(section.className).toContain("scroll-mt-2.5");
      expect(section.className).not.toContain("scroll-mt-[90px]");
    }
  });
});
