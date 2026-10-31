// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./add";

const mocks = vi.hoisted(() => ({
  // Live query results, keyed by Convex function name; called with the query's args.
  data: new Map<string, (args: unknown) => unknown>(),
  push: vi.fn<(href: string) => void>(),
  createPuzzle: vi.fn<(args: Record<string, unknown>) => Promise<string>>(),
  // One-shot convex.query reads (the member's own pending submissions after submitting).
  oneShot: vi.fn<(ref: unknown, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <T,>(options: T) => ({ options }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
      const [name, args] = queryKey;
      const read = mocks.data.get(name);
      return { data: args === "skip" || !read ? undefined : read(args) };
    },
  };
});
vi.mock("@convex-dev/react-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    convexQuery: (
      ref: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => ({
      queryKey: [getFunctionName(ref), args],
    }),
    // createPuzzle is the page's only Convex mutation; the image import action is never reached.
    useConvexMutation: () => mocks.createPuzzle,
    useConvexAction: () => vi.fn(),
  };
});
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({ query: mocks.oneShot }),
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtCheckNotice: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-upload-box-art", () => ({
  useUploadBoxArt: () => vi.fn(),
}));
vi.mock("@/components/puzzle-import/use-puzzle-import", () => ({
  usePuzzleImport: () => ({ state: { status: "idle" }, run: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const fillRequired = (title: string) => {
  fireEvent.change(screen.getByLabelText("Puzzle Title"), {
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "1000" }));
};

beforeEach(() => {
  mocks.data.clear();
  mocks.push.mockReset();
  mocks.createPuzzle.mockReset();
  mocks.createPuzzle.mockResolvedValue("aggregate-1");
  mocks.oneShot.mockReset();
  mocks.oneShot.mockResolvedValue([]);
});
afterEach(cleanup);

describe("contribute a puzzle", () => {
  it("leaves difficulty unset until the member picks one", async () => {
    renderPage();
    const difficulty = screen.getByRole("radiogroup", { name: "Difficulty" });
    const checked = Array.from(
      difficulty.querySelectorAll('[role="radio"][aria-checked="true"]'),
    ).map((radio) => radio.textContent);
    expect(checked).toEqual(["Not sure"]);

    fillRequired("Café");
    fireEvent.click(
      screen.getByRole("button", { name: "Contribute a Puzzle" }),
    );

    await waitFor(() => expect(mocks.createPuzzle).toHaveBeenCalledTimes(1));
    const args = mocks.createPuzzle.mock.calls[0][0];
    expect(args).toMatchObject({ title: "Café", pieceCount: 1000 });
    expect(args.difficulty).toBeUndefined();
  });

  it("sends the difficulty the member picked", async () => {
    renderPage();
    fillRequired("Café");
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Contribute a Puzzle" }),
    );

    await waitFor(() => expect(mocks.createPuzzle).toHaveBeenCalledTimes(1));
    expect(mocks.createPuzzle.mock.calls[0][0].difficulty).toBe("hard");
  });

  it("previews in the member's language and talks about the catalogue, not a shelf", () => {
    renderPage("nl");
    expect(screen.getByText("Titel van je puzzel")).toBeTruthy();
    expect(screen.queryByText("Your puzzle title")).toBeNull();
    expect(screen.queryByText("Brand")).toBeNull();
    expect(
      screen.getByText(
        "Zo komt de puzzel in de catalogus te staan zodra hij is goedgekeurd.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/op je plank/)).toBeNull();
  });
});

// A catalogue summary row, as puzzleSuggestions and lookupBarcode return them.
const summary = (_id: string, title: string, brand?: string) => ({
  _id,
  _creationTime: 1,
  title,
  brand,
  pieceCount: 1000,
  status: "approved" as const,
  createdAt: 1,
  updatedAt: 1,
});

describe("checking the catalogue for the puzzle being contributed", () => {
  const typeTitle = (title: string) =>
    fireEvent.change(screen.getByLabelText("Puzzle Title"), {
      target: { value: title },
    });

  it("offers an existing puzzle with the typed title, and adding a copy of it instead", async () => {
    const suggestions = vi.fn((_args: unknown) => [
      summary("p_cafe", "Café", "Jan van Haasteren"),
      summary("p_market", "Café de Markt"),
      summary("p_other", "Night Watch"),
    ]);
    mocks.data.set("catalog/getPuzzleSuggestions:getPuzzleSuggestions", (a) =>
      suggestions(a),
    );
    renderPage();

    typeTitle("Ca");
    typeTitle("Café");
    const banner = await screen.findByText(/Café · Jan van Haasteren/);
    expect(suggestions).not.toHaveBeenCalledWith(
      expect.objectContaining({ searchTerm: "ca" }),
    );
    expect(suggestions).toHaveBeenCalledWith(
      expect.objectContaining({ searchTerm: "café" }),
    );
    // Only titles that plausibly name the same puzzle are offered.
    expect(screen.getByText(/Café de Markt/)).toBeTruthy();
    expect(screen.queryByText(/Night Watch/)).toBeNull();

    const row = banner.closest("div")!;
    fireEvent.click(
      Array.from(row.querySelectorAll("button")).find(
        (b) => b.textContent === "Use this one",
      )!,
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/my-puzzles/add/new?puzzleId=p_cafe",
    );
  });

  it("lets the member say a suggested puzzle is a different one", async () => {
    mocks.data.set("catalog/getPuzzleSuggestions:getPuzzleSuggestions", () => [
      summary("p_cafe", "Café"),
    ]);
    renderPage();
    typeTitle("Café");
    await screen.findByText(/We found/);

    fireEvent.click(screen.getByRole("button", { name: "No, it's different" }));
    expect(screen.queryByText(/We found/)).toBeNull();
  });

  it("looks up a typed EAN and offers the puzzle that already carries it", async () => {
    const lookup = vi.fn((_args: unknown) =>
      summary("p_barcode", "Dorpsstraat"),
    );
    mocks.data.set("catalog/findPuzzleByBarcode:lookupPuzzleByBarcode", (a) =>
      lookup(a),
    );
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "More details (optional)" }),
    );
    fireEvent.change(screen.getByLabelText("EAN"), {
      target: { value: "4006381333931" },
    });

    await screen.findByText(/Dorpsstraat/);
    expect(lookup).toHaveBeenCalledWith({ code: "4006381333931" });
  });
});

describe("after the puzzle is submitted", () => {
  const submit = async () => {
    fillRequired("  Café ");
    fireEvent.click(
      screen.getByRole("button", { name: "Contribute a Puzzle" }),
    );
    return screen.findByRole("heading", { level: 2 });
  };

  it("says it is waiting for review and offers adding it to the member's puzzles", async () => {
    mocks.oneShot.mockResolvedValue([
      { ...summary("p_old", "Night Watch"), aggregateId: "aggregate-0" },
      { ...summary("p_new", "Café"), aggregateId: "aggregate-1" },
    ]);
    renderPage();
    const heading = await submit();

    expect(heading.textContent).toBe("“Café” is waiting for review");
    expect(document.activeElement).toBe(heading);
    expect(
      screen
        .getByRole("link", { name: "Add it to my puzzles" })
        .getAttribute("href"),
    ).toBe("/my-puzzles/add/new?puzzleId=p_new");
    expect(
      screen
        .getByRole("link", { name: "Back to the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles");
    // The member stays here: the catalogue would not show a pending puzzle.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Puzzle Title")).toBeNull();
  });

  it("only thanks the member when the new puzzle cannot be found among their pending ones", async () => {
    // An admin's submission is approved at once, so it is not in that list.
    mocks.oneShot.mockResolvedValue([]);
    renderPage();
    const heading = await submit();

    expect(heading.textContent).toBe("Thanks for contributing “Café”");
    expect(screen.queryByText(/waiting for review/)).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Add it to my puzzles" }),
    ).toBeNull();
  });

  it("still confirms the submission when looking up its id fails", async () => {
    mocks.oneShot.mockRejectedValue(new Error("offline"));
    renderPage();
    const heading = await submit();
    expect(heading.textContent).toBe("Thanks for contributing “Café”");
  });

  it("starts a fresh form for another contribution", async () => {
    renderPage();
    await submit();
    fireEvent.click(screen.getByRole("button", { name: "Contribute another" }));

    const title = screen.getByLabelText("Puzzle Title") as HTMLInputElement;
    expect(title.value).toBe("");
    expect(
      screen
        .getByRole("radio", { name: "Not sure" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("says so in Dutch", async () => {
    mocks.oneShot.mockResolvedValue([
      { ...summary("p_new", "Café"), aggregateId: "aggregate-1" },
    ]);
    renderPage("nl");
    fireEvent.change(screen.getByLabelText("Puzzeltitel"), {
      target: { value: "Café" },
    });
    fireEvent.click(screen.getByRole("button", { name: "1000" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Een puzzel bijdragen" }),
    );
    const heading = await screen.findByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("“Café” wacht op controle");
    expect(
      screen.getByRole("link", { name: "Toevoegen aan mijn puzzels" }),
    ).toBeTruthy();
  });
});
