// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { RecallLoanButton } from "./recall-loan-button";

// Recall ends a loan and records the puzzle as back with the owner, so it asks first and reports
// the outcome either way.

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const RECALL = getFunctionName(gateway.lending.recallLoan);

const renderButton = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <RecallLoanButton loanId="loan1" borrowerName="Anna" />
      </IntlProvider>
    </QueryClientProvider>,
  );

const openDialog = () => {
  renderButton();
  fireEvent.click(screen.getByRole("button", { name: "Recall" }));
  return screen.getByRole("alertdialog", { name: "Recall this puzzle?" });
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("RecallLoanButton", () => {
  it("asks before recalling and recalls nothing on Cancel", () => {
    const dialog = openDialog();
    expect(dialog.textContent).toContain(
      "This ends the loan and marks the puzzle as back with you. Let Anna know so they can return it.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("confirming recalls the loan and confirms it", async () => {
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Recall puzzle" }));
    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Loan ended. The puzzle is marked as back with you.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(RECALL, { loanId: "loan1" });
  });

  it("reports a failed recall", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("nope"));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Recall puzzle" }));
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't recall the puzzle. Please try again.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
