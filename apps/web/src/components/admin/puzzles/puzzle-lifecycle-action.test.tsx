// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { PuzzleLifecycleAction } from "./puzzle-lifecycle-action";

type ToastOptions = { action?: { label: string; onClick: () => void } };

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const DISABLE = getFunctionName(gateway.catalog.disable);
const REENABLE = getFunctionName(gateway.catalog.reenable);
const ARGS = { puzzleDefinitionId: "def-1" };

const renderAction = (
  status: "approved" | "disabled",
  locale: "en" | "nl" = "en",
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <PuzzleLifecycleAction
          aggregateId="def-1"
          title="Starry Night"
          status={status}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

// The Undo action of the most recent success toast.
const lastUndo = () => {
  const options = mocks.toastSuccess.mock.lastCall?.[1];
  expect(options?.action?.label).toBe("Undo");
  return options!.action!.onClick;
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("PuzzleLifecycleAction", () => {
  it("re-enables at once (the safe direction) and offers Undo, which disables it again", async () => {
    renderAction("disabled");
    fireEvent.click(screen.getByRole("button", { name: "Re-enable" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(REENABLE, ARGS),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "“Starry Night” re-enabled",
        expect.anything(),
      ),
    );

    lastUndo()();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenLastCalledWith(DISABLE, ARGS),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith(
        "“Starry Night” disabled",
        expect.anything(),
      ),
    );
  });

  it("still confirms Disable, then offers Undo, which re-enables it", async () => {
    renderAction("approved");
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(DISABLE, ARGS),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

    lastUndo()();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenLastCalledWith(REENABLE, ARGS),
    );
  });

  it("says when the undo fails (nl)", async () => {
    renderAction("disabled", "nl");
    fireEvent.click(screen.getByRole("button", { name: "Weer inschakelen" }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.toastSuccess.mock.lastCall?.[1]?.action?.label).toBe(
      "Ongedaan maken",
    );
    mocks.mutation.mockRejectedValue(new Error("boom"));
    mocks.toastSuccess.mock.lastCall![1]!.action!.onClick();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Kon de puzzel niet uitschakelen. Probeer het opnieuw.",
      ),
    );
  });
});
