// @vitest-environment happy-dom
import { ConvexQueryClient } from "@convex-dev/react-query";
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

type Action = "onLogSolve" | "onStartSolve";

// A card's ⋯ trigger: the menu item that opened the dialog is gone by the time it closes.
function Card({ action, inProgress }: { action: Action; inProgress: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { cardActions, dialogs } = useCopyCardActions({
    copies: [COPY],
    householdAccessById: new Map(),
    solveStateByCopyId: new Map(
      inProgress
        ? [
            [
              COPY._id,
              {
                inProgress: true,
                completed: false,
                inProgressCompletionId: "completion-1",
                inProgressStartDate: Date.UTC(2026, 9, 1),
              },
            ],
          ]
        : [],
    ),
  });
  return (
    <>
      <button ref={triggerRef} type="button">
        More actions
      </button>
      <button
        type="button"
        onClick={() =>
          cardActions(COPY._id)[action](COPY._id as never, triggerRef)
        }
      >
        Menu item
      </button>
      {dialogs}
    </>
  );
}

const renderCard = (action: Action, inProgress = false) => {
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
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Card action={action} inProgress={inProgress} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("useCopyCardActions: the solve dialogs hand focus back to the card's ⋯", () => {
  it.each([
    ["Log a solve", "onLogSolve", false],
    ["Start puzzle", "onStartSolve", false],
    ["Finish solve", "onStartSolve", true],
  ] as const)("%s", async (_label, action, inProgress) => {
    renderCard(action, inProgress);
    fireEvent.click(screen.getByRole("button", { name: "Menu item" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    // Radix hands focus back on a timeout once a dialog goes.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More actions" }),
    );
  });
});
