// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { EditCompletionDialog } from "./edit-completion-dialog";

// Edit changes a solve's facts. It never finishes or un-finishes one: an in-progress solve has no
// end date or time to edit (finishing goes through Finish), and clearing a finished solve's end
// date does not put it back in progress, so the dialog must not suggest either.

const calls = vi.hoisted(() => ({
  edit: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/gateway", () => ({
  gateway: { solving: { editCompletion: "editCompletion" } },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => async (args: Record<string, unknown>) => {
    calls.edit.push(args);
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const START = Date.UTC(2026, 9, 12);
const END = Date.UTC(2026, 9, 14);

const renderDialog = (props: {
  inProgress?: boolean;
  initialEndDate?: number;
  initialTimeMinutes?: number;
  initialNotes?: string;
}) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <EditCompletionDialog
        open
        onOpenChange={() => {}}
        completionId="c1"
        initialStartDate={START}
        {...props}
      />
    </IntlProvider>,
  );

beforeEach(() => {
  calls.edit = [];
  toasts.success.mockClear();
});
afterEach(() => cleanup());

describe("EditCompletionDialog", () => {
  it("scrolls on a short screen, so Save stays reachable", () => {
    renderDialog({ initialEndDate: END });
    expect(screen.getByRole("dialog").className).toContain("overflow-y-auto");
  });

  it("edits a finished solve's dates and time, without the in-progress hint", () => {
    renderDialog({ initialEndDate: END, initialTimeMinutes: 200 });
    expect(screen.queryByText(/Leave empty/)).toBeNull();
    expect(
      screen.getByText("Change the dates, time or notes of this solve."),
    ).toBeDefined();
    expect(
      (screen.getByLabelText("Start date") as HTMLInputElement).value,
    ).toBe("2026-10-12");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe(
      "2026-10-14",
    );
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe(
      "3",
    );
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe(
      "20",
    );
    // Hours and minutes are labelled visibly, not by placeholder alone.
    expect(
      screen.getByRole("group", { name: "How long did it take? (optional)" }),
    ).toBeDefined();
    expect(screen.getByText("Hours").tagName).toBe("LABEL");
    expect(screen.getByText("Minutes").tagName).toBe("LABEL");
  });

  it("hides the end date and time of a solve still in progress", async () => {
    renderDialog({ inProgress: true, initialEndDate: END });
    expect(screen.queryByText(/Leave empty/)).toBeNull();
    expect(
      screen.getByText(
        "Change when you started or your notes. Finish the solve when you're done.",
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText("End date")).toBeNull();
    expect(screen.queryByLabelText("Hours")).toBeNull();
    expect(screen.queryByLabelText("Minutes")).toBeNull();

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-10-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.edit).toHaveLength(1));
    expect(calls.edit[0]).toMatchObject({
      completionId: "c1",
      startDate: Date.UTC(2026, 9, 10),
      endDate: undefined,
      completionTimeMinutes: undefined,
    });
  });

  it("sends an emptied note as empty, so the server clears it", async () => {
    renderDialog({ initialEndDate: END, initialNotes: "Missing a corner" });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() => expect(calls.edit).toHaveLength(1));
    expect(calls.edit[0]?.notes).toBe("");
  });

  it("says a saved edit updated the solve, not that it logged one", async () => {
    renderDialog({ initialEndDate: END });
    fireEvent.click(screen.getByRole("button", { name: "Save solve" }));
    await vi.waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Solve updated"),
    );
  });
});
