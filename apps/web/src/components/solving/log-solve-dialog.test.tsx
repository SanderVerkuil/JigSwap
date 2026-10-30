// @vitest-environment happy-dom
import { localTodayInput } from "@/lib/date-input";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LogSolveDialog } from "./log-solve-dialog";

// Logging a solve starts from "Finished" with both dates on today. A solve that is still going is
// one tap on "Still solving", never a cleared native date input (hard to find on phones).

const calls = vi.hoisted(() => ({
  record: [] as Array<Record<string, unknown>>,
  followUp: [] as unknown[],
}));

vi.mock("@/gateway", () => ({
  gateway: {
    solving: { recordCompletion: "recordCompletion" },
    library: { updateDetails: "updateDetails" },
  },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (ref: string) => async (args: Record<string, unknown>) => {
    if (ref === "recordCompletion") calls.record.push(args);
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
  useCompletionFollowUp: () => ({
    requestFollowUp: (target: unknown) => calls.followUp.push(target),
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderDialog = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <LogSolveDialog
        open
        onOpenChange={() => {}}
        copyId="copy-1"
        puzzleTitle="Mountain Lake"
      />
    </IntlProvider>,
  );

beforeEach(() => {
  calls.record = [];
  calls.followUp = [];
});
afterEach(() => cleanup());

describe("LogSolveDialog: finished or still solving", () => {
  it("starts as a finished solve dated today", () => {
    renderDialog();
    const status = screen.getByRole("radiogroup", {
      name: "Have you finished it?",
    });
    expect(status).toBeDefined();
    expect(
      screen
        .getByRole("radio", { name: "Finished" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe(
      localTodayInput(),
    );
    expect(screen.getByLabelText("All pieces were present")).toBeDefined();
    expect(screen.queryByText(/Leave empty/)).toBeNull();
  });

  it("hides the end date, pieces and time while still solving, and saves it in progress", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Still solving" }));
    expect(screen.queryByLabelText("End date")).toBeNull();
    expect(screen.queryByLabelText("All pieces were present")).toBeNull();
    expect(screen.queryByLabelText("Hours")).toBeNull();
    expect(screen.queryByLabelText("Minutes")).toBeNull();

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-10-28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.record).toHaveLength(1));
    expect(calls.record[0]).toMatchObject({
      copyId: "copy-1",
      startDate: Date.UTC(2026, 9, 28),
      endDate: undefined,
      completionTimeMinutes: undefined,
      allPiecesPresent: undefined,
    });
    // An in-progress save gets no rating/review/photo follow-up.
    expect(calls.followUp).toEqual([]);
  });

  it("brings the end date back when switching to finished again", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Still solving" }));
    fireEvent.click(screen.getByRole("radio", { name: "Finished" }));
    const end = screen.getByLabelText("End date") as HTMLInputElement;
    expect(end.value).toBe(localTodayInput());
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-10-27" },
    });
    fireEvent.change(end, { target: { value: "2026-10-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.record).toHaveLength(1));
    expect(calls.record[0]).toMatchObject({
      startDate: Date.UTC(2026, 9, 27),
      endDate: Date.UTC(2026, 9, 29),
      allPiecesPresent: true,
    });
  });

  it("reads naturally in Dutch", () => {
    renderDialog("nl");
    expect(
      screen.getByRole("radiogroup", { name: "Is de puzzel af?" }),
    ).toBeDefined();
    expect(screen.getByRole("radio", { name: "Afgerond" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Nog bezig" })).toBeDefined();
  });
});
