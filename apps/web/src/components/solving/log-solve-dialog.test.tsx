// @vitest-environment happy-dom
import { localTodayInput } from "@/lib/date-input";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
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

const failure = vi.hoisted(() => ({ next: null as Error | null }));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (ref: string) => async (args: Record<string, unknown>) => {
    if (failure.next) throw failure.next;
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
  failure.next = null;
});
afterEach(() => cleanup());

// Save stays enabled and checks the whole form, like the goal form: what to fix sits next to the
// field and takes focus, and nothing impossible reaches the server.
describe("LogSolveDialog: what it refuses", () => {
  const save = () =>
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
  const setDate = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("refuses an end before the start, next to the end date, and focuses it", async () => {
    renderDialog();
    setDate("Start date", "2026-10-12");
    setDate("End date", "2026-10-10");
    save();
    const end = screen.getByLabelText("End date");
    expect(
      screen.getByText("The finish date can't be before the start date."),
    ).toBeDefined();
    expect(end.getAttribute("aria-invalid")).toBe("true");
    expect(end.getAttribute("aria-describedby")).toBe("solve-end-error");
    expect(document.activeElement).toBe(end);
    expect(calls.record).toEqual([]);
  });

  it("refuses an end in the future, and offers no such date in the picker", () => {
    renderDialog();
    const end = screen.getByLabelText("End date");
    expect(end.getAttribute("max")).toBe(localTodayInput());
    setDate("End date", "2999-01-01");
    save();
    expect(
      screen.getByText("The finish date can't be in the future."),
    ).toBeDefined();
    expect(calls.record).toEqual([]);
  });

  it("refuses negative hours, and clears the error once they change", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "-2" },
    });
    save();
    const message = "Use whole numbers: hours from 0, minutes from 0 to 59.";
    expect(screen.getByText(message)).toBeDefined();
    expect(calls.record).toEqual([]);
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "2" },
    });
    expect(screen.queryByText(message)).toBeNull();
  });

  it("asks for a date that was cleared, instead of disabling Save", () => {
    renderDialog();
    setDate("Start date", "");
    const button = screen.getByRole("button", { name: "Save solve" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByText("Pick a date.")).toBeDefined();
    expect(calls.record).toEqual([]);
  });

  it("still lets a solve in progress start in the future", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Still solving" }));
    expect(screen.getByLabelText("Start date").getAttribute("max")).toBeNull();
    setDate("Start date", "2999-01-01");
    save();
    await vi.waitFor(() => expect(calls.record).toHaveLength(1));
  });

  it("puts what the server refuses next to the field instead of a generic toast", async () => {
    failure.next = new ConvexError({
      code: "InvalidTimeRange",
      message: "x",
    });
    renderDialog();
    save();
    await screen.findByText("The finish date can't be before the start date.");
  });
});

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
