// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
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
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ComponentType } from "react";
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
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.search,
  useRouter: () => ({ history: {}, invalidate: vi.fn() }),
  useLocation: () => ({ pathname: "/my-puzzles/add/new" }),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
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

const ACQUIRE = getFunctionName(gateway.library.createOwned);
const UPDATE_SHARING = getFunctionName(gateway.library.updateSharing);
const COPY_DOC_ID = getFunctionName(gateway.library.copyDocId);

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

const renderPage = (search: Record<string, unknown> = {}) => {
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
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

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
    for (const name of ["For Trade", "For Lend", "For Sale"]) {
      expect(offerChip(name).getAttribute("aria-pressed")).toBe("false");
    }

    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() => expect(callsTo(ACQUIRE)).toHaveLength(1));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(callsTo(UPDATE_SHARING)).toEqual([]);
  });

  it("offers the copy only when the member switches an offer on", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID });
    fireEvent.click(offerChip("For Lend"));

    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    await waitFor(() => expect(callsTo(UPDATE_SHARING)).toHaveLength(1));
    expect(callsTo(UPDATE_SHARING)[0]).toMatchObject({
      copyId: "copy_agg_1",
      forTrade: false,
      forLend: true,
      forSale: false,
    });
  });
});

describe("creating a new puzzle", () => {
  it("starts with every offer off and does not list availability as a step", () => {
    renderPage();
    for (const name of ["For Trade", "For Lend", "For Sale"]) {
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

    expect(await landing()).toEqual({ to: "/my-puzzles" });
    // The copy was added: no failure toast.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("goes back to the flow it came from when returnTo is set", async () => {
    renderPage({ puzzleId: PUZZLE_DOC_ID, returnTo: "/welcome?step=puzzles" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Library" }));

    expect(await landing()).toEqual({ href: "/welcome?step=puzzles" });
    expect(callsTo(COPY_DOC_ID)).toEqual([]);
  });
});

describe("cancelling", () => {
  it("returns to the add chooser from the full form", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/my-puzzles/add" });
  });
});
