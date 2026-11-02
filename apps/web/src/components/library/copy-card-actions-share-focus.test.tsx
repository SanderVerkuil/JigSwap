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
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { useRef } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { useCopyCardActions } from "./copy-card-actions";

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({ Link: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

const COPY = {
  _id: "copy-doc-1",
  aggregateId: "copy-agg-1",
  puzzle: { title: "Harbour Lights" },
};

// A card's ⋯ trigger: the menu item that opened the dialog is gone by the time it closes.
function Card() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { cardActions, dialogs } = useCopyCardActions({
    copies: [COPY],
    householdAccessById: new Map(),
    solveStateByCopyId: new Map(),
  });
  return (
    <>
      <button ref={triggerRef} type="button">
        More actions
      </button>
      <button
        type="button"
        onClick={() =>
          cardActions(COPY._id).onShareWithCircles?.(
            COPY._id as never,
            triggerRef,
          )
        }
      >
        Menu item
      </button>
      {dialogs}
    </>
  );
}

const renderCard = () => {
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
    convexQuery(gateway.sharing.copyCircleShares, { copyId: COPY.aggregateId })
      .queryKey,
    [] as never,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Card />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("useCopyCardActions: Share with circles…", () => {
  it("hands focus back to the card's ⋯ trigger when the dialog closes", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Menu item" }));
    const title = en.circles.shareDialog.title.replace(
      "{title}",
      COPY.puzzle.title,
    );
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    // Radix hands focus back on a timeout once a dialog goes.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.queryByRole("heading", { name: title })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More actions" }),
    );
  });
});
