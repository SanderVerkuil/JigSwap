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
  trackDuration: [] as boolean[],
}));

// The member's "track solve times" preference: undefined until they choose.
const settings = vi.hoisted(() => ({
  trackCompletionDuration: true as boolean | undefined,
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
  useUserSettings: () => ({
    isLoading: false,
    trackCompletionDuration: settings.trackCompletionDuration,
    setTrackDuration: async (enabled: boolean) => {
      calls.trackDuration.push(enabled);
    },
  }),
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
  calls.trackDuration = [];
  settings.trackCompletionDuration = true;
});
afterEach(() => cleanup());

describe("LogSolveDialog: finished or still solving", () => {
  it("scrolls on a short screen, so Save stays reachable", () => {
    renderDialog();
    expect(screen.getByRole("dialog").className).toContain("overflow-y-auto");
  });

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

describe("LogSolveDialog: solve time", () => {
  it("asks how long it took right away for a member who hasn't chosen yet", () => {
    settings.trackCompletionDuration = undefined;
    renderDialog();
    const group = screen.getByRole("group", {
      name: "How long did it take? (optional)",
    });
    expect(group).toBeDefined();
    // Visible labels, not placeholders.
    expect(screen.getByText("Hours").tagName).toBe("LABEL");
    expect(screen.getByText("Minutes").tagName).toBe("LABEL");
    expect(screen.getByLabelText("Hours").getAttribute("placeholder")).toBe(
      null,
    );
    expect(
      screen.getByRole("button", { name: "Don't track times" }),
    ).toBeDefined();
  });

  it("records the first solve's time and goes straight to the follow-up", async () => {
    settings.trackCompletionDuration = undefined;
    renderDialog();
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Minutes"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.record).toHaveLength(1));
    expect(calls.record[0]).toMatchObject({ completionTimeMinutes: 80 });
    // No "track times?" question after saving: the follow-up opens directly.
    await vi.waitFor(() => expect(calls.followUp).toHaveLength(1));
    expect(screen.queryByText("Track how long puzzles take you?")).toBeNull();
  });

  it("lets a member opt out of solve times from the dialog", () => {
    settings.trackCompletionDuration = undefined;
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Don't track times" }));
    expect(calls.trackDuration).toEqual([false]);
  });

  it("keeps the time fields without the opt-out once times are on", () => {
    settings.trackCompletionDuration = true;
    renderDialog();
    expect(screen.getByLabelText("Hours")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Don't track times" })).toBe(
      null,
    );
  });

  it("asks no time once the member turned times off", async () => {
    settings.trackCompletionDuration = false;
    renderDialog();
    expect(
      screen.queryByRole("group", { name: "How long did it take? (optional)" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Hours")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.record).toHaveLength(1));
    expect(calls.record[0]).toMatchObject({ completionTimeMinutes: undefined });
  });

  it("asks it in Dutch", () => {
    settings.trackCompletionDuration = undefined;
    renderDialog("nl");
    expect(
      screen.getByRole("group", {
        name: "Hoelang heb je erover gedaan? (optioneel)",
      }),
    ).toBeDefined();
    expect(screen.getByLabelText("Uren")).toBeDefined();
    expect(screen.getByLabelText("Minuten")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Tijden niet bijhouden" }),
    ).toBeDefined();
  });
});
