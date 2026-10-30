// @vitest-environment happy-dom
import { localTodayInput } from "@/lib/date-input";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { FinishSolveDialog } from "./finish-solve-dialog";

// The Finish dialog asks one question (when did you finish?), names the puzzle when it can, and
// says when the solve started, because /completions/new opens it in place of the Log dialog.

const calls = vi.hoisted(() => ({
  finish: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/gateway", () => ({
  gateway: { solving: { finishCompletion: "finishCompletion" } },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => async (args: Record<string, unknown>) => {
    calls.finish.push(args);
    return { completionId: "c1", puzzleId: null, copyId: null };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

vi.mock("@/hooks/use-user-settings", () => ({
  useUserSettings: () => ({ trackCompletionDuration: true }),
}));

vi.mock("@/components/solving/completion-follow-up-provider", () => ({
  useCompletionFollowUp: () => ({ requestFollowUp: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const STARTED = Date.UTC(2026, 9, 12);

const renderDialog = (
  props: { puzzleTitle?: string; minEndDate?: number },
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <FinishSolveDialog
        open
        onOpenChange={() => {}}
        completionId="c1"
        {...props}
      />
    </IntlProvider>,
  );

beforeEach(() => {
  calls.finish = [];
});
afterEach(() => cleanup());

describe("FinishSolveDialog", () => {
  it("asks when the named puzzle was finished, and says when it was started", () => {
    renderDialog({ puzzleTitle: "Mountain Lake", minEndDate: STARTED });
    const dialog = screen.getByRole("dialog", { name: "Finish your solve" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      screen.getByText("When did you finish Mountain Lake?"),
    ).toBeDefined();
    const end = screen.getByLabelText("End date");
    expect(end.getAttribute("min")).toBe("2026-10-12");
    expect(end.getAttribute("aria-describedby")).toBe("finish-started-on");
    expect(document.getElementById("finish-started-on")?.textContent).toBe(
      "You started on October 12, 2026.",
    );
  });

  it("never offers to leave the end date empty, because finishing needs one", () => {
    renderDialog({ minEndDate: STARTED });
    expect(screen.queryByText(/Leave empty/)).toBeNull();
    expect(screen.queryByText("Solve finished")).toBeNull();
    expect(screen.getByText("When did you finish this puzzle?")).toBeDefined();
  });

  it("defaults the end date to the member's local today and stores it as UTC midnight", async () => {
    renderDialog({ puzzleTitle: "Mountain Lake" });
    const end = screen.getByLabelText("End date") as HTMLInputElement;
    expect(end.value).toBe(localTodayInput());
    expect(end.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(end, { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.finish).toHaveLength(1));
    expect(calls.finish[0]).toMatchObject({
      completionId: "c1",
      endDate: Date.UTC(2026, 9, 30),
    });
  });

  it("reads naturally in Dutch", () => {
    renderDialog({ puzzleTitle: "Bergmeer", minEndDate: STARTED }, "nl");
    expect(
      screen.getByRole("dialog", { name: "Voltooiing afronden" }),
    ).toBeDefined();
    expect(
      screen.getByText("Wanneer heb je Bergmeer afgemaakt?"),
    ).toBeDefined();
    expect(document.getElementById("finish-started-on")?.textContent).toBe(
      "Je bent op 12 oktober 2026 begonnen.",
    );
  });
});
