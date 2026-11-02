// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { PuzzleDefinitionView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import { Route } from "./new";

// The add form against mocked Convex calls: which writes a submit makes. Every Convex mutation,
// action and one-shot query is routed by function name into `mocks`.
const mocks = vi.hoisted(() => ({
  call: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
  // The leave guard's useBlocker options on the latest render.
  blocker: { disabled: true } as { disabled?: boolean },
}));

// The head reads the title from the loaded catalog of the context's locale.
vi.mock("@/lib/i18n-catalog", () => ({ messagesFor: () => en }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.search,
  useRouter: () => ({ history: {}, invalidate: vi.fn() }),
  useLocation: () => ({ pathname: "/my-puzzles/add/new" }),
  useParams: () => ({}),
  useBlocker: (options: { disabled?: boolean }) => {
    mocks.blocker = options;
    return { status: "idle" };
  },
  redirect: vi.fn(),
  notFound: vi.fn(),
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => <a href={`${to}?${new URLSearchParams(search)}`}>{children}</a>,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const call =
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.call(getFunctionName(ref), args);
  return {
    ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
    useConvexMutation: call,
    useConvexAction: call,
  };
});

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      mocks.call(getFunctionName(ref), args),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// The box-art upload (re-encode, upload URL, server check) is its own hook; here it resolves with
// the clean storage id the catalogue mutation accepts.
vi.mock("@/hooks/use-upload-box-art", () => ({
  useUploadBoxArt: () => (file: File) => mocks.call(UPLOAD_BOX_ART, file),
}));

const ACQUIRE = getFunctionName(gateway.library.createOwned);
const UPDATE_SHARING = getFunctionName(gateway.library.updateSharing);
const COPY_DOC_ID = getFunctionName(gateway.library.copyDocId);
const CREATE_PUZZLE = getFunctionName(gateway.catalog.createPuzzle);
const EXTRACT = getFunctionName(gateway.catalog.extractPuzzleFromUrl);
const UPLOAD_BOX_ART = "uploadBoxArt";

const PUZZLE_DOC_ID = "puzzle_doc_1" as Id<"puzzles">;
const PUZZLE: PuzzleDefinitionView = {
  _id: PUZZLE_DOC_ID,
  _creationTime: 0,
  aggregateId: "puzzle_agg_1",
  title: "Café",
  brand: "Goliath",
  pieceCount: 1000,
  difficulty: "medium",
  image: null,
  status: "approved",
  createdAt: 0,
  updatedAt: 0,
};

const callsTo = (name: string) =>
  mocks.call.mock.calls.filter(([n]) => n === name).map(([, args]) => args);

const renderPage = (
  search: Record<string, unknown> = {},
  ownedDefinitionIds: string[] = [],
) => {
  mocks.search = search;
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
    convexQuery(gateway.catalog.puzzleById, { puzzleId: PUZZLE_DOC_ID })
      .queryKey,
    PUZZLE,
  );
  queryClient.setQueryData(
    convexQuery(gateway.library.myOwnedDefinitionIds, {}).queryKey,
    ownedDefinitionIds,
  );
  const Page = routeOptions.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <Page />
          <PublishedHeader />
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const routeOptions = (
  Route as unknown as {
    options: {
      component: ComponentType;
      head: (ctx: {
        match: { context: unknown; search: Record<string, unknown> };
      }) => { meta: Array<{ title: string }> };
    };
  }
).options;

// What the page published into the shell's page head (title + crumb trail), as text.
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

const offerChip = (name: string) => screen.getByRole("button", { name });

// The resolved landing for a submit: what the page navigated to, once.
const landing = async () => {
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  return mocks.navigate.mock.calls[0]?.[0];
};

beforeEach(() => {
  mocks.call.mockReset();
  mocks.call.mockImplementation(async (name) =>
    name === ACQUIRE
      ? "copy_agg_1"
      : name === COPY_DOC_ID
        ? "copy_doc_1"
        : name === CREATE_PUZZLE
          ? "puzzle_agg_new"
          : name === UPLOAD_BOX_ART
            ? "storage_clean_1"
            : null,
  );
  mocks.navigate.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

describe("adding a copy of a catalogue puzzle", () => {
  it("starts with every offer off and adds the copy without offering it", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    for (const name of ["For Trade", "For Loan", "For Sale"]) {
      expect(offerChip(name).getAttribute("aria-pressed")).toBe("false");
    }

    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() => expect(callsTo(ACQUIRE)).toHaveLength(1));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(callsTo(UPDATE_SHARING)).toEqual([]);
  });

  it("offers the copy only when the member switches an offer on", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    fireEvent.click(offerChip("For Loan"));

    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() => expect(callsTo(UPDATE_SHARING)).toHaveLength(1));
    expect(callsTo(UPDATE_SHARING)[0]).toMatchObject({
      copyId: "copy_agg_1",
      forTrade: false,
      forLend: true,
      forSale: false,
    });
  });

  // The copy exists by then: reading this as a failed add would invite a retry, which adds a second.
  it("keeps the added copy when offering it fails, and says so instead of asking to retry", async () => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.call.mockImplementation(async (name: string) => {
      if (name === UPDATE_SHARING) throw new Error("offline");
      if (name === ACQUIRE) return "copy_agg_1";
      if (name === COPY_DOC_ID) return "copy_doc_1";
      return null;
    });
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    fireEvent.click(offerChip("For Loan"));

    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(en.puzzles.addedNotOffered),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(callsTo(ACQUIRE)).toHaveLength(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/my-puzzles/$id",
      params: { id: "copy_doc_1" },
      ignoreBlocker: true,
    });
  });
});

describe("a puzzle the member already owns", () => {
  it("says so at the top of the form, with a way to the copy they have", () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID }, ["puzzle_agg_1"]);
    expect(screen.getByText(/You already have this puzzle/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("href"),
    ).toBe("/my-puzzles?q=Caf%C3%A9");
    // A second copy stays possible.
    expect(
      (
        screen.getByRole("button", {
          name: "Add to Library",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("says nothing about a puzzle they don't own", () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID }, ["some_other_puzzle"]);
    expect(screen.queryByText(/You already have this puzzle/)).toBeNull();
  });
});

describe("condition", () => {
  it("offers all five conditions, by the words the copy shows later, and adds the one picked", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    const picker = screen.getByRole("radiogroup", { name: "Condition" });
    expect(
      Array.from(picker.querySelectorAll('[role="radio"]')).map(
        (r) => r.textContent,
      ),
    ).toEqual(["New (sealed)", "Like new", "Good", "Fair", "Poor"]);

    fireEvent.click(screen.getByRole("radio", { name: "New (sealed)" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() => expect(callsTo(ACQUIRE)).toHaveLength(1));
    expect(callsTo(ACQUIRE)[0]).toMatchObject({ condition: "new_sealed" });
  });
});

describe("creating a new puzzle", () => {
  it("starts with every offer off and does not list availability as a step", () => {
    renderPage();
    for (const name of ["For Trade", "For Loan", "For Sale"]) {
      expect(offerChip(name).getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByText(en.puzzles.checkTitle)).toBeTruthy();
    expect(screen.queryByText("Availability set")).toBeNull();
  });
});

describe("after adding", () => {
  it("lands on the new copy's page and offers to add another", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    expect(await landing()).toEqual({
      to: "/my-puzzles/$id",
      params: { id: "copy_doc_1" },
      ignoreBlocker: true,
    });
    expect(callsTo(COPY_DOC_ID)).toEqual([{ copyId: "copy_agg_1" }]);
    expect(toast.error).not.toHaveBeenCalled();
    const [message, options] = vi.mocked(toast.success).mock.calls[0] ?? [];
    expect(message).toBe("Added to My Puzzles");
    const action = (
      options as { action?: { label: string; onClick: () => void } }
    ).action;
    expect(action?.label).toBe("Add another");

    mocks.navigate.mockReset();
    action?.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/my-puzzles/add" });
  });

  it("falls back to My Puzzles when the copy page can't be resolved", async () => {
    mocks.call.mockImplementation(async (name) => {
      if (name === ACQUIRE) return "copy_agg_1";
      if (name === COPY_DOC_ID) throw new Error("offline");
      return null;
    });
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    expect(await landing()).toEqual({ to: "/my-puzzles", ignoreBlocker: true });
    // The copy was added: no failure toast.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("goes back to the flow it came from when returnTo is set", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID, returnTo: "/welcome?step=puzzles" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    expect(await landing()).toEqual({
      href: "/welcome?step=puzzles",
      ignoreBlocker: true,
    });
    expect(callsTo(COPY_DOC_ID)).toEqual([]);
  });
});

describe("the box photo", () => {
  const fileInput = () =>
    document.querySelector<HTMLInputElement>('input[type="file"]');
  const upload = () =>
    fireEvent.change(fileInput()!, {
      target: { files: [new File(["x"], "box.jpg", { type: "image/jpeg" })] },
    });
  const fillRequired = () => {
    fireEvent.change(screen.getByLabelText(en.puzzles.fieldTitle), {
      target: { value: "Café" },
    });
    fireEvent.change(screen.getByLabelText(en.puzzles.fieldPieceCount), {
      target: { value: "1000" },
    });
  };

  it("is not offered when adding a copy, since nothing would store it", () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    expect(fileInput()).toBeNull();
    expect(screen.getByText(en.puzzles.chooser.copyPhotosLater)).toBeTruthy();
  });

  it("offers no colour swatches, which nothing stores", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /colour/i })).toBeNull();
    expect(screen.getByText(en.puzzles.boxPhoto)).toBeTruthy();
  });

  it("sends an uploaded photo as the new catalogue puzzle's box art", async () => {
    renderPage();
    fillRequired();
    upload();

    fireEvent.click(screen.getByRole("button", { name: "Add Puzzle" }));

    await waitFor(() => expect(callsTo(CREATE_PUZZLE)).toHaveLength(1));
    expect(callsTo(CREATE_PUZZLE)[0]).toMatchObject({
      title: "Café",
      pieceCount: 1000,
      image: "storage_clean_1",
    });
  });

  it("sends no photo once the member deselects it", async () => {
    renderPage();
    fillRequired();
    upload();
    const thumb = screen.getByRole("button", { pressed: true });
    fireEvent.click(thumb);
    expect(thumb.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Add Puzzle" }));

    await waitFor(() => expect(callsTo(CREATE_PUZZLE)).toHaveLength(1));
    expect(callsTo(CREATE_PUZZLE)[0]).toMatchObject({ image: undefined });
    expect(callsTo(UPLOAD_BOX_ART)).toEqual([]);
  });

  it("is withdrawn once an import match turns the form into adding a copy", async () => {
    mocks.call.mockImplementation(async (name) =>
      name === EXTRACT
        ? {
            ok: true,
            draft: { title: "Café", sourceUrl: "https://shop.example/cafe" },
            match: {
              puzzleId: PUZZLE_DOC_ID,
              aggregateId: "puzzle_agg_1",
              title: "Café",
              pieceCount: 1000,
            },
          }
        : null,
    );
    renderPage();
    expect(fileInput()).not.toBeNull();
    fireEvent.change(
      screen.getByPlaceholderText("https://www.ravensburger.com/…"),
      { target: { value: "https://shop.example/cafe" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Fetch details/ }));

    fireEvent.click(
      await screen.findByRole("button", { name: en.puzzles.matchUseThis }),
    );

    expect(fileInput()).toBeNull();
    expect(screen.getByText(en.puzzles.chooser.copyPhotosLater)).toBeTruthy();
  });
});

describe("on phones and tablets", () => {
  it("recaps what the submit adds right above the submit buttons", () => {
    renderPage();
    expect(screen.queryByTestId("add-summary")).toBeNull();
    fireEvent.change(screen.getByLabelText(en.puzzles.fieldTitle), {
      target: { value: "Café" },
    });
    fireEvent.change(screen.getByLabelText(en.puzzles.fieldPieceCount), {
      target: { value: "1000" },
    });
    fireEvent.click(offerChip("For Trade"));

    const summary = screen.getByTestId("add-summary");
    expect(summary.textContent).toContain("Café");
    expect(summary.textContent).toContain("1,000 pieces");
    expect(summary.textContent).toContain("For Trade");
    const submit = screen.getByRole("button", { name: "Add Puzzle" });
    expect(
      summary.compareDocumentPosition(submit) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("previews the real My Puzzles card, following the form", () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Puzzle Title" }), {
      target: { value: "Kattenshow" },
    });
    fireEvent.click(offerChip("For Trade"));
    const preview = screen.getByText("Live preview").parentElement!;
    expect(
      within(preview).getByRole("heading", { name: "Kattenshow" }),
    ).toBeTruthy();
    expect(within(preview).getByTestId("copy-condition").textContent).toContain(
      "Good",
    );
    expect(within(preview).getByTestId("copy-offers").textContent).toBe(
      "For Trade",
    );
    expect(within(preview).queryByText("Available")).toBeNull();
    // Nothing to open or act on: there is no copy yet.
    expect(within(preview).queryByRole("link")).toBeNull();
  });

  it("previews no piece count until one is entered, as a real card can't have none", () => {
    renderPage();
    const preview = screen.getByText("Live preview").parentElement!;
    expect(within(preview).queryByText(/piece/)).toBeNull();
    fireEvent.change(screen.getByLabelText(en.puzzles.fieldPieceCount), {
      target: { value: "1000" },
    });
    expect(within(preview).getByText("1,000 pieces")).toBeTruthy();
  });

  it("shows no look-alike buttons in the live preview", () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });
});

describe("accessible inputs", () => {
  it("names the tag and import fields by their labels", () => {
    renderPage();
    expect(
      screen.getByRole("textbox", {
        name: `${en.puzzles.fieldTags} ${en.puzzles.optional}`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: en.puzzles.importUrlPlaceholder }),
    ).toBeTruthy();
  });
});

describe("cancelling", () => {
  it("returns to the add chooser from the full form", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/my-puzzles/add" });
  });
});

describe("leaving with unsaved work", () => {
  const asks = () => mocks.blocker.disabled === false;

  it("doesn't ask about an untouched form, even one prefilled from the link", () => {
    renderPage({ title: "Zzzznotfound", ean: "4005556123456" });
    expect(asks()).toBe(false);
  });

  it("asks once a field differs, and not after it is put back", () => {
    renderPage();
    const title = screen.getByRole("textbox", { name: "Puzzle Title" });
    fireEvent.change(title, { target: { value: "Kattenshow" } });
    expect(asks()).toBe(true);
    fireEvent.change(title, { target: { value: "" } });
    expect(asks()).toBe(false);
  });

  it("counts a chosen box photo as work", () => {
    renderPage();
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      {
        target: { files: [new File(["x"], "box.png", { type: "image/png" })] },
      },
    );
    expect(asks()).toBe(true);
  });

  it("in copy mode ignores what the catalogue filled in, but not the member's own fields", () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    expect(asks()).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Notes/ }), {
      target: { value: "Missing one piece" },
    });
    expect(asks()).toBe(true);
  });

  it("is clear again after Save & Add Another emptied the form", async () => {
    renderPage({ title: "Zzzznotfound" });
    fireEvent.change(screen.getByLabelText("Piece Count"), {
      target: { value: "500" },
    });
    expect(asks()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save & Add Another" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(asks()).toBe(false));
  });
});

describe("page title", () => {
  it("calls copy mode 'Add your copy', under My Library > Add Puzzle", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    await waitFor(() =>
      expect(publishedHeader()).toBe(
        "My Library@/library > Add Puzzle@/my-puzzles/add > Add your copy",
      ),
    );
    expect(
      screen.getByText("Record its condition and how you'd like to share it."),
    ).toBeTruthy();
  });

  it("keeps the route's own title on the full form", () => {
    renderPage();
    expect(publishedHeader()).toBe("");
  });

  it("names the document after the mode", () => {
    const title = (search: Record<string, unknown>) =>
      routeOptions.head({
        match: { context: { intl: { locale: "en" } }, search },
      }).meta[0]?.title;
    expect(title({ puzzleId: PUZZLE_DOC_ID })).toBe("Add your copy — JigSwap");
    expect(title({})).toBe(en.titles.createPuzzle);
  });
});
