// @vitest-environment happy-dom
import type { Id } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { useCopyCardActions } from "./copy-card-actions";

// A puzzle card's Finish action opens the Finish dialog for that card's puzzle, by name.

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => vi.fn(),
  convexQuery: () => ({ queryKey: ["convex"], enabled: false }),
}));
vi.mock("@/hooks/use-user-settings", () => ({
  useUserSettings: () => ({
    isLoading: false,
    trackCompletionDuration: false,
    setTrackDuration: vi.fn(),
  }),
}));
vi.mock("@/components/solving/completion-follow-up-provider", () => ({
  useCompletionFollowUp: () => ({ requestFollowUp: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COPY_ID = "copy-row-1" as Id<"ownedPuzzles">;
const solveState = new Map([
  [
    COPY_ID as string,
    {
      inProgress: true,
      completed: false,
      inProgressCompletionId: "completion-1",
      inProgressStartDate: Date.UTC(2026, 9, 12),
    },
  ],
]);
const noHouseholdAccess = new Map();

function Card({ title }: { title?: string }) {
  const { cardActions, dialogs } = useCopyCardActions({
    copies: [
      { _id: COPY_ID, aggregateId: "copy-1", puzzle: title ? { title } : null },
    ],
    householdAccessById: noHouseholdAccess,
    solveStateByCopyId: solveState,
  });
  return (
    <>
      <button
        onClick={() =>
          cardActions(COPY_ID).onStartSolve(COPY_ID, { current: null })
        }
      >
        finish
      </button>
      {dialogs}
    </>
  );
}

const renderCard = (title?: string) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Card title={title} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "finish" }));
};

afterEach(cleanup);

describe("useCopyCardActions: finishing a solve", () => {
  it("asks when the card's puzzle was finished, by name", () => {
    renderCard("Mountain Lake");
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(
      screen.getByText("When did you finish Mountain Lake?"),
    ).toBeDefined();
  });

  it("asks generically when the copy has no puzzle title", () => {
    renderCard();
    expect(screen.getByText("When did you finish this puzzle?")).toBeDefined();
  });
});
