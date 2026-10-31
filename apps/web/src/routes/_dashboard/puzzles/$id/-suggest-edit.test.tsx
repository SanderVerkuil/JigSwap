// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import nl from "../../../../../locales/nl.json";
import { Route } from "./suggest-edit";

type View = NonNullable<FunctionReturnType<typeof gateway.catalog.puzzleById>>;

const PUZZLE_ID = "puzzle_1";

const mocks = vi.hoisted(() => ({
  // Query results keyed by Convex function name.
  data: new Map<string, unknown>(),
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <T,>(options: T) => ({ options, useParams: () => ({ id: PUZZLE_ID }) }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [string] }) => ({
    data: mocks.data.get(queryKey[0]),
  }),
  // The form is never submitted here.
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    convexQuery: (ref: Parameters<typeof name>[0]) => ({
      queryKey: [name(ref)],
    }),
    useConvexMutation: () => vi.fn(),
  };
});
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtCheckNotice: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-upload-box-art", () => ({
  useUploadBoxArt: () => vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// An approved puzzle whose catalogue entry never recorded a difficulty, shape or category.
function sparseView(): View {
  return {
    _id: PUZZLE_ID as View["_id"],
    _creationTime: 0,
    aggregateId: "definition-1",
    title: "Café",
    brand: "Goliath",
    pieceCount: 1000,
    status: "approved",
    createdAt: 0,
    updatedAt: 0,
  };
}

const setQuery = (ref: Parameters<typeof getFunctionName>[0], value: unknown) =>
  mocks.data.set(getFunctionName(ref), value);

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <Page />
    </IntlProvider>,
  );
};

// Both breakpoint layouts are in the DOM (CSS picks one); the lg side panel is the <aside>.
const outsideSidePanel = (elements: HTMLElement[]) =>
  elements.filter((element) => !element.closest("aside"));

beforeEach(() => {
  mocks.data.clear();
  mocks.push.mockReset();
  setQuery(gateway.catalog.puzzleById, sparseView());
  setQuery(gateway.catalog.listMyChangeProposals, []);
  setQuery(gateway.catalog.puzzleCategories, [
    {
      _id: "category_1",
      aggregateId: "category-1",
      name: { en: "Landscape", nl: "Landschap" },
    },
  ]);
  setQuery(gateway.catalog.allPublishers, []);
  setQuery(gateway.catalog.allBrands, []);
  setQuery(gateway.catalog.allSeries, []);
});
afterEach(cleanup);

describe("suggest an edit below lg", () => {
  it("recaps the changed fields above the inline buttons", () => {
    renderPage();
    expect(
      outsideSidePanel(screen.queryAllByText(/^Changes \(\d+\)$/)),
    ).toEqual([]);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Café de Paris" },
    });

    const [heading] = outsideSidePanel(screen.getAllByText("Changes (1)"));
    expect(heading).toBeTruthy();
    const recap = heading.parentElement!;
    expect(recap.textContent).toContain("Title");
    const [cancel] = outsideSidePanel(
      screen.getAllByRole("button", { name: "Cancel" }),
    );
    expect(
      recap.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("explains the disabled submit instead of recapping nothing", () => {
    renderPage("nl");
    expect(
      outsideSidePanel(
        screen.getAllByText(
          "Wijzig minstens één veld om een voorstel in te dienen",
        ),
      ),
    ).toHaveLength(1);
    expect(outsideSidePanel(screen.queryAllByText(/^Wijzigingen/))).toEqual([]);
  });
});

const pills = (group: string) =>
  Array.from(
    screen
      .getByRole("radiogroup", { name: group })
      .querySelectorAll<HTMLElement>('[role="radio"]'),
  );
const checked = (group: string) =>
  pills(group)
    .filter((pill) => pill.getAttribute("aria-checked") === "true")
    .map((pill) => pill.textContent);
const tabStops = (group: string) =>
  pills(group).filter((pill) => pill.tabIndex === 0);

describe("suggest an edit shows only what the catalogue knows", () => {
  it("selects no difficulty or shape the puzzle never had, but keeps both reachable", () => {
    renderPage();
    for (const group of ["Difficulty", "Shape"]) {
      expect(checked(group)).toEqual([]);
      expect(tabStops(group)).toHaveLength(1);
    }
  });

  it("selects the difficulty and shape the puzzle has", () => {
    setQuery(gateway.catalog.puzzleById, {
      ...sparseView(),
      difficulty: "hard",
      shape: "round",
    });
    renderPage();
    expect(checked("Difficulty")).toEqual(["Hard"]);
    expect(checked("Shape")).toEqual(["Round"]);
  });

  it("suggests a difficulty only once the member picks one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Expert" }));
    expect(checked("Difficulty")).toEqual(["Expert"]);
    const [heading] = outsideSidePanel(screen.getAllByText("Changes (1)"));
    expect(heading.parentElement!.textContent).toContain("Difficulty");
  });

  it("invites a category when the puzzle has none", () => {
    renderPage("nl");
    expect(screen.getByText("Nog geen categorie — kies er een")).toBeTruthy();
    cleanup();
    renderPage("en");
    expect(screen.getByText("No category yet — choose one")).toBeTruthy();
  });
});
