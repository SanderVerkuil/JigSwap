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
  it("shows new results from the top, so the first one is never cut off", () => {
    const scrollTo = vi
      .spyOn(HTMLElement.prototype, "scrollTo")
      .mockImplementation(() => {});
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <DocsSearch open onOpenChange={() => {}} />
      </IntlProvider>,
    );
    const box = screen.getByRole("combobox");

    scrollTo.mockClear();
    act(() => {
      fireEvent.change(box, { target: { value: "lend" } });
    });

    expect(screen.getByText("Page lend")).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});
