// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { useCopyCardActions } from "./copy-card-actions";

// A card's ⋯ menu offers a copy the same way its page's switches do: offers only, never a
// visibility, with an Undo toast; and only for whoever may manage the copy.

type ToastOptions = { action?: { label: string; onClick: () => void } };

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
}));

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

const UPDATE_SHARING = getFunctionName(gateway.library.updateSharing);
const COPIES = [
  {
    _id: "row1",
    aggregateId: "agg1",
    puzzle: { title: "Harbour Lights" },
    availability: { forTrade: true, forLend: false, forSale: false },
    visibility: "visible" as const,
  },
];

function Harness({ viewerAccess }: { viewerAccess?: "manage" | "view" }) {
  const { cardActions } = useCopyCardActions({
    copies: COPIES,
    householdAccessById: new Map(
      viewerAccess ? [["row1", { viewerAccess }]] : [],
    ),
    solveStateByCopyId: new Map(),
  });
  const { onToggleOffer } = cardActions("row1");
  return onToggleOffer ? (
    <button
      type="button"
      onClick={() => onToggleOffer("row1" as never, "forLend", true)}
    >
      offer to lend
    </button>
  ) : (
    <p>no offers</p>
  );
}

const renderHarness = (viewerAccess?: "manage" | "view") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Harness viewerAccess={viewerAccess} />
      </IntlProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
});
afterEach(cleanup);

describe("the card menu's offers", () => {
  it("adds the offer to what's on, without a visibility, and confirms with Undo", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "offer to lend" }));
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(UPDATE_SHARING, {
      copyId: "agg1",
      forTrade: true,
      forLend: true,
      forSale: false,
    });
    const [message, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(message).toBe("Offered to lend");
    expect(options?.action?.label).toBe("Undo");
  });

  it("is there for a housemate who may manage the copy", () => {
    renderHarness("manage");
    expect(screen.getByRole("button", { name: "offer to lend" })).toBeTruthy();
  });

  it("isn't there for a housemate who may only view it", () => {
    renderHarness("view");
    expect(screen.getByText("no offers")).toBeTruthy();
  });
});
