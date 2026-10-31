// @vitest-environment happy-dom
// UX-55: the palette keeps its jump-to destinations and quick actions while a term is typed. cmdk
// filters them on the localized title plus bilingual keywords; live search results sit above them,
// "Searching…" is an extra row while the query runs, and the empty text only shows when nothing
// at all matches. The member's own copies are a live group of their own, above the catalogue.
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CommandPalette } from "./command-palette";

const mocks = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_me" } }),
}));

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

type Results = FunctionReturnType<typeof gateway.search.global>;

const NO_HITS: Results = {
  puzzles: [],
  copies: [],
  people: [],
  circles: [],
  collections: [],
};

// Each searched term is its own query key: a term seeded here resolves, any other stays pending.
const renderPalette = ({
  locale = "en",
  seeded = {},
}: {
  locale?: "en" | "nl";
  seeded?: Record<string, Results>;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.identity.isAdmin, {}).queryKey,
    false,
  );
  for (const [term, results] of Object.entries(seeded)) {
    queryClient.setQueryData(
      convexQuery(gateway.search.global, { term }).queryKey,
      results,
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "nl" ? nl : en}
        timeZone="Europe/Amsterdam"
      >
        <CommandPalette open setOpen={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const type = (term: string) =>
  fireEvent.change(screen.getByRole("combobox"), { target: { value: term } });

const option = (name: string) => screen.queryByRole("option", { name });

beforeEach(() => {
  mocks.push.mockReset();
});

afterEach(cleanup);

describe("CommandPalette", () => {
  it("lists the Go To destinations and quick actions with an empty input", () => {
    renderPalette();
    expect(option("Goals")).not.toBeNull();
    expect(option("Messages")).not.toBeNull();
    expect(option("Add a Puzzle")).not.toBeNull();
  });

  it.each([
    ["gol", "Goals"],
    ["mess", "Messages"],
    ["add", "Add a Puzzle"],
    ["ruil", "Exchanges"],
    ["swap", "Exchanges"],
  ])(
    "keeps the matching destination for “%s” while results load",
    async (term, name) => {
      renderPalette();
      type(term);
      await waitFor(() => expect(screen.getByText("Searching…")).toBeTruthy());
      expect(option(name)).not.toBeNull();
      expect(screen.queryByText(/No results/)).toBeNull();
    },
  );

  it.each([
    ["add", "Add a Puzzle"],
    ["mess", "Messages"],
  ])(
    "lists the best match for “%s” first, so Enter picks it",
    async (term, name) => {
      renderPalette();
      type(term);
      await screen.findByText("Searching…");
      await waitFor(() =>
        expect(screen.getAllByRole("option")[0]?.textContent).toBe(name),
      );
      expect(option(name)?.getAttribute("aria-selected")).toBe("true");
    },
  );

  it("matches English keywords in the Dutch palette", async () => {
    renderPalette({ locale: "nl" });
    type("messages");
    await waitFor(() => expect(option("Berichten")).not.toBeNull());
  });

  it("drops destinations that do not match the term", async () => {
    renderPalette();
    type("ruil");
    await waitFor(() => expect(option("Goals")).toBeNull());
  });

  it("puts live results above the matching destinations", async () => {
    renderPalette({
      seeded: {
        gol: {
          ...NO_HITS,
          puzzles: [
            {
              id: "p1",
              title: "Golden Gate",
              brand: "Ravensburger",
              image: null,
              href: "/puzzles/p1",
            },
          ],
        },
      },
    });
    type("gol");
    const hit = await screen.findByRole("option", {
      name: /Golden Gate/,
    });
    const goals = option("Goals");
    expect(goals).not.toBeNull();
    expect(
      hit.compareDocumentPosition(goals!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("Searching…")).toBeNull();

    fireEvent.click(hit);
    expect(mocks.push).toHaveBeenCalledWith("/puzzles/p1");
  });

  it("shows the empty text only once the search is done and nothing matches", async () => {
    renderPalette({ seeded: { qqq: NO_HITS } });
    type("qqq");
    await waitFor(() =>
      expect(screen.getByText("No results for “qqq”")).toBeTruthy(),
    );
    expect(screen.queryByText("Searching…")).toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("does not claim there are no results while the search still runs", async () => {
    renderPalette();
    type("qqq");
    await waitFor(() => expect(screen.getByText("Searching…")).toBeTruthy());
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  // UX-58: quick actions open the action itself, not the list page behind it.
  it.each([
    ["Add a Puzzle", "/my-puzzles/add"],
    ["Log a Completion", "/completions/new"],
    ["Create a Circle", "/circles?create=1"],
    ["Browse Community", "/browse"],
  ])("“%s” goes to %s", (name, href) => {
    renderPalette();
    fireEvent.click(screen.getByRole("option", { name }));
    expect(mocks.push).toHaveBeenCalledWith(href);
  });

  // UX-06: Users stands for Community (its tab and hub); Circles has its own glyph everywhere.
  it("draws circles with the Circles icon, not the Community one", async () => {
    renderPalette({
      seeded: {
        book: {
          ...NO_HITS,
          circles: [{ id: "c1", name: "Book club", href: "/circles/c1" }],
        },
      },
    });
    const createCircle = screen.getByRole("option", {
      name: "Create a Circle",
    });
    expect(createCircle.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-blend",
    );
    type("book");
    const hit = await screen.findByRole("option", { name: "Book club" });
    expect(hit.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-blend",
    );
  });

  it("navigates to a destination picked from a filtered list", async () => {
    renderPalette();
    type("mess");
    // Past the debounce, so the backend search is in flight too.
    await screen.findByText("Searching…");
    fireEvent.click(screen.getByRole("option", { name: "Messages" }));
    expect(mocks.push).toHaveBeenCalledWith("/messages");
  });
});

// ⌘K finds the member's own copies: an "In your library" group, listed before the catalogue's
// Puzzles, whose rows open the owner's copy page.
describe("CommandPalette library copies", () => {
  const lam: Results = {
    ...NO_HITS,
    puzzles: [
      { id: "p1", title: "Lam Gelegd", image: null, href: "/puzzles/p1" },
    ],
    copies: [
      {
        id: "c1",
        title: "Lam Gelegd",
        brand: "Jumbo",
        image: null,
        href: "/my-puzzles/c1",
      },
    ],
  };

  it("lists the member's own copies before the catalogue's puzzles", async () => {
    renderPalette({ seeded: { lam } });
    type("lam");
    await screen.findByRole("group", { name: "In your library" });
    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map(
      (heading) => heading.textContent,
    );
    expect(headings.slice(0, 2)).toEqual(["In your library", "Puzzles"]);
  });

  it("opens the owner's copy page", async () => {
    renderPalette({ seeded: { lam } });
    type("lam");
    const group = await screen.findByRole("group", {
      name: "In your library",
    });
    const row = group.querySelector("[cmdk-item]");
    expect(row?.textContent).toContain("Lam Gelegd");
    expect(row?.textContent).toContain("Jumbo");
    fireEvent.click(row!);
    expect(mocks.push).toHaveBeenCalledWith("/my-puzzles/c1");
  });
});
