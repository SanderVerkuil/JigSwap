// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { ConvexQueryClient } from "@convex-dev/react-query";
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
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ReturnLoanButton } from "./return-loan-button";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
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

const RETURN = getFunctionName(gateway.lending.returnLoan);

const renderButton = (locale: "en" | "nl" = "en") => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ReturnLoanButton
          loanId="loan-1"
          puzzleTitle="Harbour Lights"
          lenderName="Anna"
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const confirmIn = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Return" });

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("ReturnLoanButton", () => {
  it("states the consequence and returns only once confirmed", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Return Harbour Lights?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Only do this once Anna has the puzzle back. The loan closes, and you can't undo this.",
      ),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(confirmIn(dialog));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Harbour Lights returned to Anna",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(RETURN, { loanId: "loan-1" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the pending label while returning", async () => {
    mocks.mutation.mockReturnValue(new Promise(() => {}));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    fireEvent.click(confirmIn(screen.getByRole("alertdialog")));
    await waitFor(() =>
      expect(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Returning…",
        }),
      ).toBeTruthy(),
    );
  });

  it("says why a return was refused and keeps the dialog open", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "LoanNotOpen", message: "x" }),
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    fireEvent.click(confirmIn(screen.getByRole("alertdialog")));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "This loan has already been closed.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderButton("nl");
    fireEvent.click(screen.getByRole("button", { name: "Teruggeven" }));
    expect(screen.getByText("Harbour Lights teruggeven?")).toBeTruthy();
    expect(
      screen.getByText(
        "Doe dit pas als Anna de puzzel terug heeft. De lening wordt afgesloten en dat kun je niet ongedaan maken.",
      ),
    ).toBeTruthy();
  });
});
