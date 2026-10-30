// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MyHouseholdCopies } from "./my-household-copies";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const copy = (
  id: string,
  title: string,
  householdPermission: "manage" | "view",
  coverUrl?: string,
  permissionSource: "explicit" | "default" = "explicit",
) => ({
  _id: id,
  puzzleId: "p",
  ownerId: "me",
  condition: "good",
  availability: { forTrade: false, forSale: false, forLend: false },
  createdAt: 1,
  updatedAt: 1,
  puzzle: null,
  snapshot: { title, pieceCount: 1000 },
  coverUrl,
  householdPermission,
  permissionSource,
});

const render = (copies: unknown[], locale: "en" | "nl" = "en") => {
  // No network: SSR never runs effects, so the query only reads the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.household.myCopyPermissions, {}).queryKey,
    copies,
  );
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <MyHouseholdCopies householdDefault="view" onError={() => {}} />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
  );
};

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const elementsOf = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};

const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const textOf = (el: Element): string =>
  el.childNodes
    .map((n) =>
      "value" in n && n.nodeName === "#text"
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");

describe("MyHouseholdCopies", () => {
  it("lists each own copy with a labelled checkbox, thumbnail and current permission", () => {
    const els = elementsOf(
      render([
        copy("a", "Harbour", "manage", "https://img/a.jpg"),
        copy("b", "Forest", "view", undefined, "default"),
      ]),
    );
    expect(textOf(els.find((e) => e.tagName === "h2")!)).toBe(
      "My puzzles in this household",
    );
    const rows = els.filter((e) => e.tagName === "li");
    expect(rows.map(textOf)).toEqual([
      "HarbourSet for this puzzleCan manage",
      "ForestHousehold defaultView only",
    ]);
    const boxes = els.filter((e) => attr(e, "role") === "checkbox");
    expect(boxes.map((b) => attr(b, "aria-label"))).toEqual([
      "Select Harbour",
      "Select Forest",
    ]);
    expect(boxes.every((b) => attr(b, "aria-checked") === "false")).toBe(true);
    expect(
      els.filter((e) => e.tagName === "img").map((i) => attr(i, "src")),
    ).toEqual(["https://img/a.jpg"]);
  });

  it("keeps the toolbar to the filter and Select all while nothing is selected", () => {
    const els = elementsOf(render([copy("a", "Harbour", "manage")]));
    const buttons = els.filter((e) => e.tagName === "button").map(textOf);
    expect(buttons).toContain("Select all");
    // No count and no disabled bulk actions until a puzzle is ticked.
    expect(buttons).not.toContain("Set access");
    expect(buttons).not.toContain("Select none");
    expect(els.map(textOf)).not.toContain("0 selected");
  });

  it("shows the empty state in Dutch when the member has no puzzles", () => {
    const els = elementsOf(render([], "nl"));
    expect(els.filter((e) => e.tagName === "li")).toEqual([]);
    expect(els.map(textOf)).toContain("Je hebt nog geen puzzels toegevoegd.");
  });
});

const renderInteractive = (copies: unknown[]) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.household.myCopyPermissions, {}).queryKey,
    copies,
  );
  renderDom(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MyHouseholdCopies householdDefault="view" onError={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

describe("MyHouseholdCopies selection bar", () => {
  afterEach(() => {
    cleanup();
    mocks.mutation.mockReset();
  });

  const two = [copy("a", "Harbour", "manage"), copy("b", "Forest", "view")];
  const bar = () => screen.queryByRole("button", { name: "Set access" });

  it("appears after the list once a puzzle is ticked, and goes with the last tick", () => {
    renderInteractive(two);
    expect(bar()).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Harbour" }));
    const trigger = bar();
    expect(trigger).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 selected");
    // After the list, so ticking a box never pushes the rows down.
    const list = screen.getByRole("list");
    expect(
      list.compareDocumentPosition(trigger!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Harbour" }));
    expect(bar()).toBeNull();
  });

  it("counts Select all, and Clear empties the selection and returns focus to Select all", () => {
    renderInteractive(two);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("status").textContent).toBe("2 selected");

    const clear = screen.getByRole("button", { name: "Clear selection" });
    clear.focus();
    fireEvent.click(clear);
    expect(bar()).toBeNull();
    expect(
      screen
        .getAllByRole("checkbox")
        .every((box) => box.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Select all" }),
    );
  });

  it("changes the ticked puzzles to the chosen access after a confirm", async () => {
    mocks.mutation.mockResolvedValue({ changed: 1 });
    renderInteractive(two);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Forest" }));

    fireEvent.pointerDown(bar()!, { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Can manage",
      "View only",
      "Use household default (currently: View only)",
    ]);
    fireEvent.click(items[0]);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Change 1 puzzle?");
    fireEvent.click(screen.getByRole("button", { name: "Change access" }));

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "library/setCopiesHouseholdPermission:setCopiesHouseholdPermission",
        { copyIds: ["b"], permission: "manage" },
      ),
    );
    await waitFor(() => expect(bar()).toBeNull());
    // The bar left with the selection: focus waits on Select all, not on the page body.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Select all" }),
      ),
    );
  });
});
