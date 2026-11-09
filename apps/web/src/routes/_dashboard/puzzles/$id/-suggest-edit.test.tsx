// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { gateway } from "@/gateway";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
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
  // Queries that failed (an id the server can't read), keyed the same way.
  failed: new Set<string>(),
  push: vi.fn<(href: string) => void>(),
  navigate: vi.fn(),
  // The leave guard's useBlocker options on the latest render.
  blocker: { disabled: true } as { disabled?: boolean },
  // The submit mutation's options, so a test can run its onSuccess.
  submit: undefined as { onSuccess?: () => void } | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <T,>(options: T) => ({ options, useParams: () => ({ id: PUZZLE_ID }) }),
  useNavigate: () => mocks.navigate,
  useBlocker: (options: { disabled?: boolean }) => {
    mocks.blocker = options;
    return { status: "idle" };
  },
  useLocation: () => `/puzzles/${PUZZLE_ID}/suggest-edit`,
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [string] }) => ({
    data: mocks.data.get(queryKey[0]),
    isError: mocks.failed.has(queryKey[0]),
  }),
  // The form is never sent here; a test runs the success handler itself.
  useMutation: (options: { onSuccess?: () => void }) => {
    mocks.submit = options;
    return { isPending: false, mutate: vi.fn() };
  },
}));
// The photo editor stands in as one button that applies a cropped file.
vi.mock("@/components/image-editor/lazy-image-editor-dialog", () => ({
  LazyImageEditorDialog: ({
    src,
    onApply,
  }: {
    src: string | null;
    onApply: (file: File) => void;
  }) =>
    src ? (
      <button type="button" onClick={() => onApply(new File(["x"], "box.jpg"))}>
        apply photo
      </button>
    ) : null,
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

// What the page published into the shell's page head: its title, and its crumbs as "label@href".
function PublishedHeader() {
  const { title, crumbs } = usePageHeaderContent();
  return (
    <output data-testid="published-header">
      {[...(crumbs ?? []).map((c) => `${c.label}@${c.href}`), title]
        .filter(Boolean)
        .join(" > ")}
    </output>
  );
}
const publishedHeader = () =>
  screen.getByTestId("published-header").textContent;

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <PageHeaderSlotProvider>
        <Page />
        <PublishedHeader />
      </PageHeaderSlotProvider>
    </IntlProvider>,
  );
};

// Both breakpoint layouts are in the DOM (CSS picks one); the lg side panel is the <aside>.
const outsideSidePanel = (elements: HTMLElement[]) =>
  elements.filter((element) => !element.closest("aside"));

beforeEach(() => {
  mocks.data.clear();
  mocks.failed.clear();
  mocks.push.mockReset();
  mocks.navigate.mockReset();
  mocks.blocker = { disabled: true };
  mocks.submit = undefined;
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

describe("a puzzle that can't be found or edited", () => {
  const backLink = (name: string) =>
    screen.getByRole("link", { name }).getAttribute("href");

  // F47: an id the server can't read used to spin forever under the catalogue's head.
  it("says an unreadable id's puzzle isn't found, with a way back to the catalogue", () => {
    mocks.data.delete(getFunctionName(gateway.catalog.puzzleById));
    mocks.failed.add(getFunctionName(gateway.catalog.puzzleById));
    renderPage();

    expect(publishedHeader()).toBe(en.puzzleDefinition.notFound);
    expect(screen.getByText(en.puzzleDefinition.notFoundSub)).toBeTruthy();
    expect(backLink("Back to Puzzles catalogue")).toBe("/puzzles");
    expect(screen.queryByText(en.suggestEdit.title)).toBeNull();
  });

  it("keeps the form and its edits when a read fails after the puzzle loaded", () => {
    mocks.failed.add(getFunctionName(gateway.catalog.puzzleById));
    renderPage();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.queryByText(en.puzzleDefinition.notFoundSub)).toBeNull();
  });

  it("says the same for a puzzle that's gone", () => {
    setQuery(gateway.catalog.puzzleById, null);
    renderPage("nl");
    expect(publishedHeader()).toBe(nl.puzzleDefinition.notFound);
    expect(backLink("Terug naar Puzzelcatalogus")).toBe("/puzzles");
  });

  it("keeps 'can't be edited' for a puzzle still waiting for approval, with a way back to it", () => {
    setQuery(gateway.catalog.puzzleById, {
      ...sparseView(),
      status: "pending",
    });
    renderPage();
    expect(publishedHeader()).toBe(en.suggestEdit.notFound);
    expect(screen.getByText(en.suggestEdit.notFoundSub)).toBeTruthy();
    expect(backLink(en.copyConversation.backToPuzzle)).toBe(
      `/puzzles/${PUZZLE_ID}`,
    );
  });
});

describe("leaving with unsaved work", () => {
  const asks = () => mocks.blocker.disabled === false;
  const title = () => screen.getByLabelText("Title");

  it("doesn't ask about an untouched form", () => {
    renderPage();
    expect(asks()).toBe(false);
  });

  it("asks once a field differs, and not after it is put back", () => {
    renderPage();
    fireEvent.change(title(), { target: { value: "Café de Paris" } });
    expect(asks()).toBe(true);
    fireEvent.change(title(), { target: { value: "Café" } });
    expect(asks()).toBe(false);
  });

  it("counts a picked cover as work, with nothing else changed", () => {
    renderPage();
    const [picker] = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    fireEvent.change(picker, {
      target: { files: [new File(["x"], "box.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "apply photo" }));
    expect(asks()).toBe(true);
  });

  it("doesn't ask about a reopened suggestion the member hasn't touched", () => {
    setQuery(gateway.catalog.listMyChangeProposals, [
      {
        aggregateId: "proposal-1",
        puzzleDefinitionId: "definition-1",
        status: "pending",
        changes: { title: "Café de Paris" },
        comment: "The box says so",
      },
    ]);
    renderPage();
    expect((title() as HTMLInputElement).value).toBe("Café de Paris");
    expect(asks()).toBe(false);
    fireEvent.change(title(), { target: { value: "Café de Lyon" } });
    expect(asks()).toBe(true);
  });

  it("goes to the puzzle after sending without asking", () => {
    renderPage();
    fireEvent.change(title(), { target: { value: "Café de Paris" } });
    mocks.submit?.onSuccess?.();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/puzzles/$id",
      params: { id: PUZZLE_ID },
      ignoreBlocker: true,
    });
  });
});
