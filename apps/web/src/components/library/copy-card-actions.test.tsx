// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { useCopyCardActions } from "./copy-card-actions";

// Deleting a copy from its card: the Library refuses while an exchange in progress reserves the
// copy or it is out on loan (CopyReserved), and the member is told why instead of nothing.

const mocks = vi.hoisted(() => ({
  deleteOwned: vi.fn<(args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
}));

vi.mock("@/gateway", () => ({
  gateway: {
    library: { deleteOwned: "deleteOwned" },
    solving: { mySolveStates: "mySolveStates" },
  },
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string, args: unknown) => ({ fn, args }),
  useConvexMutation: () => mocks.deleteOwned,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("@/components/solving/log-solve-dialog", () => ({
  LogSolveDialog: () => null,
}));
vi.mock("@/components/solving/start-solve-dialog", () => ({
  StartSolveDialog: () => null,
}));
vi.mock("@/components/solving/finish-solve-dialog", () => ({
  FinishSolveDialog: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const COPIES = [
  { _id: "row1", aggregateId: "agg1", puzzle: { title: "Harbour Lights" } },
];

function Harness() {
  const { cardActions, dialogs } = useCopyCardActions({
    copies: COPIES,
    householdAccessById: new Map(),
    solveStateByCopyId: new Map(),
  });
  const onDelete = cardActions("row1").onDelete;
  return (
    <>
      <button type="button" onClick={() => onDelete?.("row1" as never)}>
        open delete
      </button>
      {dialogs}
    </>
  );
}

const confirmDelete = () => {
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Harness />
    </IntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "open delete" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: en.puzzles.deleteConfirmAction,
    }),
  );
};

beforeEach(() => {
  mocks.deleteOwned.mockReset();
  mocks.toastError.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCopyCardActions delete", () => {
  it("says why when the copy is held by an exchange or a loan", async () => {
    mocks.deleteOwned.mockRejectedValue(
      new ConvexError({ code: "CopyReserved", message: "x" }),
    );
    confirmDelete();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(en.puzzles.deleteReserved),
    );
    expect(mocks.deleteOwned).toHaveBeenCalledWith({ copyId: "agg1" });
  });
});
