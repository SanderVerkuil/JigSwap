// @vitest-environment happy-dom
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
import en from "../../../locales/en.json";
import { CataloguePicker } from "./catalogue-picker";

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
