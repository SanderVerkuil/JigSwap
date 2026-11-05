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
import { RecallLoanButton } from "./recall-loan-button";

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

const RECALL = getFunctionName(gateway.lending.recallLoan);

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
        <RecallLoanButton
          loanId="loan-1"
          puzzleTitle="Harbour Lights"
          borrowerName="Bas"
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const confirmIn = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Recall" });

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("RecallLoanButton", () => {
  it("states the consequence and recalls only once confirmed", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Recall Harbour Lights?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Only do this once you have the puzzle back from Bas. The loan closes, and you can't undo this.",
      ),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(confirmIn(dialog));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Harbour Lights recalled from Bas",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(RECALL, { loanId: "loan-1" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says why a recall was refused and keeps the dialog open", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "NotLender", message: "x" }),
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    fireEvent.click(confirmIn(screen.getByRole("alertdialog")));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Only the owner can recall this puzzle.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderButton("nl");
    fireEvent.click(screen.getByRole("button", { name: "Terugvragen" }));
    expect(screen.getByText("Harbour Lights terugvragen?")).toBeTruthy();
    expect(
      screen.getByText(
        "Doe dit pas als je de puzzel terug hebt van Bas. De lening wordt afgesloten en dat kun je niet ongedaan maken.",
      ),
    ).toBeTruthy();
  });
});
