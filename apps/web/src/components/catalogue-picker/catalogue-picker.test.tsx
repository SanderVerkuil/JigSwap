// @vitest-environment happy-dom
import {
  createStepCommitStore,
  StepCommitContext,
} from "@/components/quick-start/step-commit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CataloguePicker } from "./catalogue-picker";
import { clearPickTray } from "./pick-tray";

type Items = { puzzleDefinitionId: string; forTrade: boolean }[];

const mocks = vi.hoisted(() => ({
  acquire: vi.fn<(args: { items: Items }) => Promise<{ copyIds: string[] }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  onAdded: vi.fn<(copyIds: string[]) => void>(),
}));

// Thirty search results, so a full pick spans two acquireCopies chunks.
const RESULTS = Array.from({ length: 30 }, (_, i) => ({
  _id: `doc_${i}`,
  aggregateId: `def_${i}`,
  title: `Puzzle ${i}`,
  pieceCount: 1000,
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (_ref: unknown, args: unknown) => ({
    results: args === "skip" ? [] : RESULTS,
    status: "Exhausted",
  }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined, isFetching: false }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => mocks.acquire,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const copiesFor = ({ items }: { items: Items }) => ({
  copyIds: items.map((item) => `copy_${item.puzzleDefinitionId}`),
});

beforeEach(() => {
  clearPickTray();
  mocks.acquire.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.onAdded.mockReset();
});
afterEach(cleanup);

const renderPicker = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CataloguePicker onAdded={mocks.onAdded} />
      </IntlProvider>
    </QueryClientProvider>,
  );

const pickAll = async () => {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "puzzle" },
  });
  await screen.findByRole("button", { name: "Add Puzzle 0" });
  for (const r of RESULTS) {
    fireEvent.click(screen.getByRole("button", { name: `Add ${r.title}` }));
  }
};

describe("CataloguePicker", () => {
  it("still has the picks when the member comes back from Register", async () => {
    renderPicker();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "puzzle" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Puzzle 0" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Puzzle 1" }));

    // Register leaves the page, which unmounts the picker; returning mounts a fresh one.
    cleanup();
    renderPicker();
    expect(
      await screen.findByRole("button", { name: "Add 2 puzzles" }),
    ).toBeTruthy();
    expect(screen.getByText("Picked (2)")).toBeTruthy();
  });

  it("empties the tray once the picks are added", async () => {
    mocks.acquire.mockImplementation(async (args) => copiesFor(args));
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));
    await waitFor(() => expect(mocks.onAdded).toHaveBeenCalled());

    cleanup();
    renderPicker();
    expect(screen.queryByText(/^Picked/)).toBeNull();
  });

  it("adds more than 25 picks in chunks of 25, one call after the other", async () => {
    mocks.acquire.mockImplementation(async (args) => copiesFor(args));
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "30 puzzles added to your shelf",
      ),
    );
    expect(mocks.acquire.mock.calls.map(([a]) => a.items.length)).toEqual([
      25, 5,
    ]);
    expect(mocks.onAdded).toHaveBeenCalledWith(
      RESULTS.map((r) => `copy_${r.aggregateId}`),
    );
  });

  it("keeps the picks a refused chunk didn't add, and says how many were added", async () => {
    mocks.acquire
      .mockImplementationOnce(async (args) => copiesFor(args))
      .mockRejectedValueOnce(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Added 25 of 30 puzzles. The rest are still picked, so you can try again.",
      ),
    );
    expect(mocks.onAdded).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Add 5 puzzles" }),
    ).toBeTruthy();
    // The tray (one swap switch per pick) holds exactly the five that weren't added.
    expect(
      screen.getByRole("switch", { name: "Puzzle 29 available to swap" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: "Puzzle 0 available to swap" }),
    ).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(5);
  });

  // A refused chunk comes back in the result, not as a thrown error (acquireInChunks never throws),
  // and the daily copy budget is a wait, not a retry.
  it("says to wait when the daily limit refuses the first chunk", async () => {
    mocks.acquire.mockRejectedValue(new ConvexError({ code: "RateLimited" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've added a lot of puzzles today. Try again tomorrow.",
      ),
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("says how many were added and to wait when the daily limit refuses a later chunk", async () => {
    mocks.acquire
      .mockImplementationOnce(async (args) => copiesFor(args))
      .mockRejectedValueOnce(new ConvexError({ code: "RateLimited" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Added 25 of 30 puzzles, the most you can add today. The rest are still picked, so you can add them tomorrow.",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Add 5 puzzles" }),
    ).toBeTruthy();
  });

  it("says nothing was added when the first chunk is refused", async () => {
    mocks.acquire.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Add 30 puzzles" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't add these puzzles, so nothing was added. Please try again.",
      ),
    );
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: "Add 30 puzzles" }),
    ).toBeTruthy();
  });
});

describe("CataloguePicker inside quick setup", () => {
  const renderInFlow = () => {
    const store = createStepCommitStore();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <StepCommitContext value={store}>
            <CataloguePicker />
          </StepCommitContext>
        </IntlProvider>
      </QueryClientProvider>,
    );
    return store;
  };
  const continueCommit = async (store: ReturnType<typeof renderInFlow>) => {
    let saved: boolean | undefined;
    await act(async () => {
      saved = await store.commit();
    });
    return saved;
  };

  it("has no submit of its own; Continue adds every pick in chunks of 25", async () => {
    mocks.acquire.mockImplementation(async (args) => copiesFor(args));
    const store = renderInFlow();
    await pickAll();
    expect(screen.queryByRole("button", { name: "Add 30 puzzles" })).toBeNull();
    expect(store.getSnapshot()).toEqual({
      kind: "puzzles",
      count: 30,
      ready: true,
    });

    expect(await continueCommit(store)).toBe(true);
    expect(mocks.acquire.mock.calls.map(([a]) => a.items.length)).toEqual([
      25, 5,
    ]);
    expect(store.getSnapshot()?.count).toBe(0);
  });

  it("keeps the member on the step when a chunk is refused, with the rest still picked", async () => {
    mocks.acquire
      .mockImplementationOnce(async (args) => copiesFor(args))
      .mockRejectedValueOnce(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = renderInFlow();
    await pickAll();

    expect(await continueCommit(store)).toBe(false);
    expect(store.getSnapshot()?.count).toBe(5);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Added 25 of 30 puzzles. The rest are still picked, so you can try again.",
    );
  });
});
