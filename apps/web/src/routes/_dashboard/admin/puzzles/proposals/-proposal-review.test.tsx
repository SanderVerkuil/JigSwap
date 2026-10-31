// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../../locales/en.json";
import { Route } from "./$proposalId";

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
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
}));
// The route module only needs its options back and the proposal id param.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ proposalId: "cp-1" }),
  }),
}));

const APPROVE = getFunctionName(gateway.catalog.approveChangeProposal);
const REVIEWED_AT = 1_761_818_400_000;

const proposal = (updatedAt: number, title: string) => ({
  _id: "row_cp-1",
  _creationTime: 0,
  aggregateId: "cp-1",
  puzzleDefinitionId: "pd-1",
  proposedBy: "users_bob",
  status: "pending" as const,
  changes: { title },
  baseline: { title: "Mountain Vista" },
  createdAt: REVIEWED_AT,
  updatedAt,
  puzzleId: "puzzles_1",
  definitionTitle: "Mountain Vista",
  proposerName: "Bob",
  current: { title: "Mountain Vista" },
  conflictFields: [],
  hasConflict: false,
});

const setup = () => {
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
  const proposalKey = convexQuery(gateway.admin.getChangeProposal, {
    changeProposalId: "cp-1",
  }).queryKey;
  queryClient.setQueryData(
    proposalKey,
    proposal(REVIEWED_AT, "Mountain Vista (Panorama)"),
  );
  queryClient.setQueryData(
    convexQuery(gateway.catalog.puzzleCategories, {}).queryKey,
    [],
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
  // Stand-in for the live query pushing the proposer's edit to the open page.
  const liveEdit = (updatedAt: number, title: string) =>
    act(() => {
      queryClient.setQueryData(proposalKey, proposal(updatedAt, title));
    });
  return { liveEdit };
};

// Both layouts mount the actions row (one CSS-hidden), so take the first Approve.
const openApproveConfirm = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
  const dialog = screen.getByRole("alertdialog");
  return within(dialog).getByRole("button", { name: "Approve" });
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("proposal review approve", () => {
  it("approves the version that was on screen when the admin clicked Approve", async () => {
    mocks.mutation.mockResolvedValue(null);
    const { liveEdit } = setup();
    const confirm = openApproveConfirm();
    // The proposer edits while the confirm dialog covers the diff.
    liveEdit(REVIEWED_AT + 5_000, "Something never reviewed");
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(APPROVE, {
        changeProposalId: "cp-1",
        expectedUpdatedAt: REVIEWED_AT,
      }),
    );
  });

  it("says the proposal changed when the backend refuses a stale approval", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "ChangeProposalChanged", message: "stale" }),
    );
    setup();
    fireEvent.click(openApproveConfirm());

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.admin.proposals.changedSinceReview,
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the specific message for a taken barcode and a generic one otherwise", async () => {
    mocks.mutation.mockRejectedValueOnce(
      new ConvexError({ code: "DuplicateBarcode", message: "taken" }),
    );
    setup();
    fireEvent.click(openApproveConfirm());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.admin.proposals.duplicateBarcode,
      ),
    );

    mocks.mutation.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(openApproveConfirm());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenLastCalledWith(
        en.admin.proposals.actionFailed,
      ),
    );
  });
});
