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

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

// A loaded index with one page per query.
vi.mock("@/docs/search-store", () => {
  const index = {
    search: (query: string) =>
      query
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
