// @vitest-environment happy-dom
// UX-60: the solve form dialogs (log, finish, edit) offer an explicit Cancel next to their save
// action, so leaving is not limited to the corner X or Escape. Cancel closes the dialog and
// writes nothing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { EditCompletionDialog } from "./edit-completion-dialog";
import { FinishSolveDialog } from "./finish-solve-dialog";
import { LogSolveDialog } from "./log-solve-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => mocks.mutation,
}));

vi.mock("@/hooks/use-user-settings", () => ({
  useUserSettings: () => ({ trackCompletionDuration: true }),
}));

vi.mock("@/components/solving/duration-prompt-provider", () => ({
  useDurationPrompt: () => ({ requestPrompt: vi.fn() }),
}));

vi.mock("@/components/solving/completion-follow-up-provider", () => ({
  useCompletionFollowUp: () => ({ requestFollowUp: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {children}
      </IntlProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue({});
});
afterEach(cleanup);

describe("solve dialogs Cancel", () => {
  it("Log a solve: Cancel closes without recording a completion", () => {
    const onOpenChange = vi.fn();
    wrap(
      <LogSolveDialog
        open
        onOpenChange={onOpenChange}
        copyId="copy-1"
        puzzleTitle="Secret Garden"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("Finish a solve: Cancel closes without finishing the completion", () => {
    const onOpenChange = vi.fn();
    wrap(
      <FinishSolveDialog
        open
        onOpenChange={onOpenChange}
        completionId="completion-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("Edit a solve: Cancel closes without saving the edit", () => {
    const onOpenChange = vi.fn();
    wrap(
      <EditCompletionDialog
        open
        onOpenChange={onOpenChange}
        completionId="completion-1"
        initialStartDate={Date.UTC(2026, 9, 1)}
        initialEndDate={Date.UTC(2026, 9, 2)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
