// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { DocsSearch } from "./docs-search";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// A loaded index with one page per query; "blurred" opens Messages at a section.
vi.mock("@/docs/search-store", () => {
  const index = {
    search: (query: string) =>
      query === "blurred"
        ? [
            {
              slug: "staying-informed/messages",
              title: "Messages",
              group: "staying-informed",
              snippet: "A photo is blurred at first.",
              section: "Blurred photos",
              hash: "blurred-photos",
            },
          ]
        : query
          ? [{ slug: query, title: `Page ${query}`, group: "g", snippet: "" }]
          : [],
  };
  return {
    createDocsSearchStore: () => ({
      load: async () => {},
      subscribe: () => () => {},
      failed: () => false,
      get: () => index,
    }),
  };
});

// cmdk measures its list with ResizeObserver and scrolls items into view; there is no layout here.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

describe("DocsSearch results", () => {
  // cmdk scrolls its selection into view a few renders after a query changes, and that selection
  // can still be the last query's pick further down the list, so the scroll to the top waits for
  // the next frame to land after it (F22).
  it("shows new results from the top, a frame after cmdk's own scroll, so the first one is never cut off", () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => frames.push(cb));
    const scrollTo = vi
      .spyOn(HTMLElement.prototype, "scrollTo")
      .mockImplementation(() => {});
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <DocsSearch open onOpenChange={() => {}} />
      </IntlProvider>,
    );
    const box = screen.getByRole("combobox");
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    scrollTo.mockClear();

    act(() => {
      fireEvent.change(box, { target: { value: "lend" } });
    });
    expect(screen.getByText("Page lend")).toBeTruthy();
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    raf.mockRestore();
    scrollTo.mockRestore();
  });
});

describe("DocsSearch opens a result at its section", () => {
  const search = (query: string) => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <DocsSearch open onOpenChange={() => {}} />
      </IntlProvider>,
    );
    act(() => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: query },
      });
    });
    return screen.getByRole("option");
  };

  it("names the section after the page, in a row that stays two lines", () => {
    const row = search("blurred");
    const [title, snippet] = Array.from(
      row.querySelectorAll(":scope > div > span:not([aria-hidden])"),
    );
    expect(title.textContent).toBe("Messages › Blurred photos");
    expect(snippet.textContent).toBe("A photo is blurred at first.");
    expect(row.querySelectorAll(":scope > div > span")).toHaveLength(2);
  });

  it("goes to the section's hash", () => {
    navigate.mockClear();
    fireEvent.click(search("blurred"));
    expect(navigate).toHaveBeenCalledWith({
      to: "/docs/$",
      params: { _splat: "staying-informed/messages" },
      hash: "blurred-photos",
    });
  });

  it("goes to the top of a page with no section, titled by the page alone", () => {
    navigate.mockClear();
    const row = search("lend");
    expect(row.querySelector("span")?.textContent).toBe("Page lend");
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith({
      to: "/docs/$",
      params: { _splat: "lend" },
      hash: undefined,
    });
  });
});
