// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { LoanView } from "@jigswap/contracts";
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
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LoansTab } from "./loans-tab";

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
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The button gates itself on the member being connected; here we only check who a row offers it for.
vi.mock("@/components/social/message-button", () => ({
  MessageButton: ({ memberId, size }: { memberId: string; size?: string }) => (
    <button data-member={memberId} data-size={size}>
      Message
    </button>
  ),
}));
// The solve dialogs have their own tests; here we only check which one a row opens.
vi.mock("@/components/solving/start-solve-dialog", () => ({
  StartSolveDialog: ({ copyId }: { copyId: string }) => (
    <div role="dialog">start {copyId}</div>
  ),
}));
vi.mock("@/components/solving/finish-solve-dialog", () => ({
  FinishSolveDialog: ({
    completionId,
    puzzleTitle,
  }: {
    completionId: string;
    puzzleTitle?: string;
  }) => (
    <div role="dialog">
      finish {completionId} of {puzzleTitle}
    </div>
  ),
}));
vi.mock("@/components/solving/log-solve-dialog", () => ({
  LogSolveDialog: ({ copyId }: { copyId: string }) => (
    <div role="dialog">log {copyId}</div>
  ),
}));

type SolveStates = FunctionReturnType<typeof gateway.solving.mySolveStates>;

const RECALL = getFunctionName(gateway.lending.recallLoan);
const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 86_400_000;

const member = (id: string, name: string) => ({
  _id: id,
  _creationTime: 0,
  name,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
});

const loan = (fields: Partial<LoanView>): LoanView => ({
  loanId: "loan-1",
  copyId: "copy-agg-1",
  copyDocId: "copy-doc-1",
  puzzleTitle: "Harbour Lights",
  pieceCount: 1000,
  status: "open",
  openedAt: NOW - 3 * DAY,
  lender: member("u_anna", "Anna"),
  borrower: member("u_me", "Me"),
  ...fields,
});

const borrowedLoan = loan({});
const lentLoan = loan({
  loanId: "loan-2",
  copyId: "copy-agg-2",
  copyDocId: "copy-doc-2",
  puzzleTitle: "Tulip Fields",
  pieceCount: 500,
  lender: member("u_me", "Me"),
  borrower: member("u_bas", "Bas"),
});

const renderTab = ({
  borrowed,
  lentOut,
  solveStates = [],
  locale = "en",
}: {
  borrowed: LoanView[] | undefined;
  lentOut: LoanView[] | undefined;
  solveStates?: SolveStates;
  locale?: "en" | "nl";
}) => {
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
    convexQuery(gateway.solving.mySolveStates, {}).queryKey,
    solveStates,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={new Date(NOW)}
      >
        <LoansTab borrowed={borrowed} lentOut={lentOut} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("LoansTab", () => {
  it("lists what the viewer borrowed, with its lender, a link to the copy and the solve actions", () => {
    renderTab({ borrowed: [borrowedLoan], lentOut: [] });
    const borrowed = section("Borrowed by you 1");
    expect(
      within(borrowed)
        .getByRole("link", { name: "Harbour Lights" })
        .getAttribute("href"),
    ).toBe("/copies/copy-doc-1");
    expect(within(borrowed).getByText(/Borrowed from Anna/)).toBeTruthy();
    expect(within(borrowed).getByText(/3 days ago/)).toBeTruthy();
    for (const action of ["Start puzzle", "Log a solve", "Return"]) {
      expect(
        within(borrowed).getByRole("button", { name: action }),
      ).toBeTruthy();
    }
    // Return depends on handing it back, so the way to arrange that sits right before it.
    const buttons = within(borrowed)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons.at(-2)).toBe("Message");
    expect(buttons.at(-1)).toBe("Return");
    expect(
      within(borrowed)
        .getByRole("button", { name: "Message" })
        .getAttribute("data-member"),
    ).toBe("u_anna");

    fireEvent.click(
      within(borrowed).getByRole("button", { name: "Start puzzle" }),
    );
    expect(screen.getByRole("dialog").textContent).toBe("start copy-agg-1");
  });

  it("offers Finish solve instead of Start and Log when a solve is in progress", () => {
    renderTab({
      borrowed: [borrowedLoan],
      lentOut: [],
      solveStates: [
        {
          copyId: "copy-doc-1",
          completed: false,
          inProgress: true,
          inProgressCompletionId: "completion-1",
          inProgressStartDate: NOW - DAY,
        },
      ],
    });
    const borrowed = section("Borrowed by you 1");
    expect(
      within(borrowed).queryByRole("button", { name: "Start puzzle" }),
    ).toBeNull();
    expect(
      within(borrowed).queryByRole("button", { name: "Log a solve" }),
    ).toBeNull();
    fireEvent.click(
      within(borrowed).getByRole("button", { name: "Finish solve" }),
    );
    expect(screen.getByRole("dialog").textContent).toBe(
      "finish completion-1 of Harbour Lights",
    );
  });

  it("lists the viewer's lent-out copies with the borrower, a link to the copy and a guarded Recall", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderTab({ borrowed: [], lentOut: [lentLoan] });
    const lent = section("Lent out 1");
    expect(
      within(lent)
        .getByRole("link", { name: "Tulip Fields" })
        .getAttribute("href"),
    ).toBe("/my-puzzles/copy-doc-2");
    expect(within(lent).getByText(/On loan to Bas/)).toBeTruthy();

    fireEvent.click(within(lent).getByRole("button", { name: "Recall" }));
    const dialog = screen.getByRole("alertdialog");
    expect(mocks.mutation).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recall" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(RECALL, { loanId: "loan-2" }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Tulip Fields recalled from Bas",
      ),
    );
  });

  it("lets the lender message the borrower next to Recall", () => {
    renderTab({ borrowed: [], lentOut: [lentLoan] });
    const lent = section("Lent out 1");
    const message = within(lent).getByRole("button", { name: "Message" });
    expect(message.getAttribute("data-member")).toBe("u_bas");
    expect(message.getAttribute("data-size")).toBe("sm");
    expect(within(lent).getByRole("button", { name: "Recall" })).toBeTruthy();
  });

  it("offers no Message for a lender who has left", () => {
    renderTab({ borrowed: [loan({ lender: null })], lentOut: [] });
    expect(
      within(section("Borrowed by you 1")).queryByRole("button", {
        name: "Message",
      }),
    ).toBeNull();
  });

  it("offers no Message for a borrower who has left", () => {
    renderTab({ borrowed: [], lentOut: [{ ...lentLoan, borrower: null }] });
    const lent = section("Lent out 1");
    expect(within(lent).queryByRole("button", { name: "Message" })).toBeNull();
    expect(within(lent).getByRole("button", { name: "Recall" })).toBeTruthy();
  });

  it("says when each loan is due back, and nothing for an open-ended one", () => {
    renderTab({
      borrowed: [loan({ expectedReturn: NOW + 5 * DAY })],
      lentOut: [
        { ...lentLoan, expectedReturn: NOW - 2 * DAY },
        loan({ loanId: "loan-3", puzzleTitle: "Open Sea" }),
      ],
    });
    expect(
      within(section("Borrowed by you 1")).getByText("Due in 5 days"),
    ).toBeTruthy();
    const lent = section("Lent out 2");
    expect(within(lent).getByText("2 days overdue")).toBeTruthy();
    expect(within(lent).queryAllByText(/Due |overdue/)).toHaveLength(1);
  });

  it("shows each loan's cover, and the loan chip for a copy without one", () => {
    renderTab({
      borrowed: [loan({ coverUrl: "https://cdn.example/harbour.jpg" })],
      lentOut: [{ ...lentLoan, coverUrl: null }],
    });
    const images = (name: string) =>
      [...section(name).querySelectorAll("img")].map((img) =>
        img.getAttribute("src"),
      );
    expect(images("Borrowed by you 1")).toEqual([
      "https://cdn.example/harbour.jpg",
    ]);
    expect(images("Lent out 1")).toEqual([]);
  });

  it("names a departed member instead of leaving a blank", () => {
    renderTab({
      borrowed: [loan({ lender: null })],
      lentOut: [{ ...lentLoan, borrower: null }],
    });
    expect(screen.getByText(/Borrowed from Deleted member/)).toBeTruthy();
    expect(screen.getByText(/On loan to Deleted member/)).toBeTruthy();
  });

  it("gives each empty section its own explanation and next step", () => {
    renderTab({ borrowed: [], lentOut: [] });
    const borrowed = section("Borrowed by you 0");
    expect(within(borrowed).getByText("Nothing borrowed")).toBeTruthy();
    expect(
      within(borrowed)
        .getByRole("link", { name: "Browse puzzles" })
        .getAttribute("href"),
    ).toBe("/browse");
    const lent = section("Lent out 0");
    expect(within(lent).getByText("Nothing lent out")).toBeTruthy();
    expect(
      within(lent)
        .getByRole("link", { name: "Go to My Puzzles" })
        .getAttribute("href"),
    ).toBe("/my-puzzles");
  });

  it("shows each section loading on its own", () => {
    renderTab({ borrowed: undefined, lentOut: [lentLoan] });
    expect(
      within(section("Borrowed by you")).getByRole("status").textContent,
    ).toBe("Loading loans…");
    expect(
      within(section("Lent out 1")).getByText("Tulip Fields"),
    ).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderTab({ borrowed: [borrowedLoan], lentOut: [], locale: "nl" });
    expect(section("Door jou geleend 1")).toBeTruthy();
    expect(screen.getByText(/Geleend van Anna/)).toBeTruthy();
    expect(
      within(section("Uitgeleend 0")).getByText("Niets uitgeleend"),
    ).toBeTruthy();
  });
});
