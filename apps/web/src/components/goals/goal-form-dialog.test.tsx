// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { GoalFormDialog, type EditableGoal } from "./goal-form-dialog";

// The goal form never sits there disabled without saying why: Submit is always enabled, checks
// the whole form, and puts what to fix next to each field (aria-invalid + aria-describedby),
// moving focus to the first one. A new goal defaults to this calendar year.

const calls = vi.hoisted(() => ({
  create: [] as Array<Record<string, unknown>>,
  update: [] as Array<Record<string, unknown>>,
  reject: undefined as unknown,
}));

vi.mock("@/gateway", () => ({
  gateway: { solving: { createGoal: "createGoal", updateGoal: "updateGoal" } },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation:
    (name: "createGoal" | "updateGoal") =>
    async (args: Record<string, unknown>) => {
      if (calls.reject) throw calls.reject;
      (name === "createGoal" ? calls.create : calls.update).push(args);
      return "goal-1";
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const GOAL: EditableGoal = {
  _id: "row-1" as EditableGoal["_id"],
  _creationTime: Date.UTC(2026, 2, 3, 15),
  aggregateId: "goal-1",
  userId: "user-1" as EditableGoal["userId"],
  title: "Ten big ones",
  description: "1000 pieces or more",
  targetCompletions: 10,
  currentCompletions: 4,
  startDate: Date.UTC(2026, 0, 1),
  targetDate: Date.UTC(2026, 11, 31),
  isActive: true,
  isAchieved: false,
  createdAt: Date.UTC(2026, 2, 3, 15),
  updatedAt: Date.UTC(2026, 2, 3, 15),
};

const renderForm = (
  props: { goal?: EditableGoal } = {},
  locale: "en" | "nl" = "en",
) => {
  const onOpenChange = vi.fn();
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <GoalFormDialog open onOpenChange={onOpenChange} {...props} />
    </IntlProvider>,
  );
  return { onOpenChange };
};

const input = (label: string | RegExp) =>
  screen.getByLabelText(label) as HTMLInputElement;

const errorOf = (field: HTMLElement) => {
  const ids = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids
    .map((id) => document.getElementById(id))
    .find((el) => el?.className.includes("text-destructive"))?.textContent;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12));
  calls.create = [];
  calls.update = [];
  calls.reject = undefined;
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GoalFormDialog: create", () => {
  it("starts empty over this calendar year, with the required fields marked", () => {
    renderForm();
    expect(screen.getByRole("dialog", { name: "Create a goal" })).toBeDefined();
    expect(screen.getByText("Fields marked * are required.")).toBeDefined();
    expect(input(/^Title/).required).toBe(true);
    expect(input(/^Target completions/).required).toBe(true);
    expect(input("From").value).toBe("2026-01-01");
    expect(input("To").value).toBe("2026-12-31");
    // The end date can't be picked before today.
    expect(input("To").getAttribute("min")).toBe("2026-10-30");
    const target = input(/^Target completions/);
    expect(target.getAttribute("step")).toBe("1");
    expect(target.getAttribute("min")).toBe("1");
  });

  it("keeps Submit enabled and says what is missing, focusing the first field to fix", () => {
    renderForm();
    const submit = screen.getByRole("button", { name: "Create goal" });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);

    const title = input(/^Title/);
    const target = input(/^Target completions/);
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(title)).toBe("Give your goal a title.");
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(target)).toBe("Enter how many puzzles you want to finish.");
    expect(document.activeElement).toBe(title);
    expect(calls.create).toHaveLength(0);
  });

  it.each(["0", "2.5", "-1"])(
    "refuses a target of %s with a reason instead of a server error",
    (value) => {
      renderForm();
      fireEvent.change(input(/^Title/), { target: { value: "Ten" } });
      fireEvent.change(input(/^Target completions/), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
      const target = input(/^Target completions/);
      expect(errorOf(target)).toBe("Use a whole number of 1 or more.");
      expect(document.activeElement).toBe(target);
      expect(calls.create).toHaveLength(0);
    },
  );

  it("clears a field's error as soon as it is edited", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    fireEvent.change(input(/^Title/), { target: { value: "Ten" } });
    expect(input(/^Title/).getAttribute("aria-invalid")).toBeNull();
    expect(input(/^Title/).getAttribute("aria-describedby")).toBeNull();
    // The other field keeps its error.
    expect(input(/^Target completions/).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("refuses an end date in the past and one before the start date", () => {
    renderForm();
    fireEvent.change(input(/^Title/), { target: { value: "Ten" } });
    fireEvent.change(input(/^Target completions/), { target: { value: "10" } });
    fireEvent.change(input("To"), { target: { value: "2026-10-29" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    expect(errorOf(input("To"))).toBe("Pick an end date from today on.");
    expect(document.activeElement).toBe(input("To"));

    fireEvent.change(input("From"), { target: { value: "2026-12-01" } });
    fireEvent.change(input("To"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    expect(errorOf(input("To"))).toBe(
      "The end date can't be before the start date.",
    );
    expect(input("To").getAttribute("min")).toBe("2026-12-01");
    expect(calls.create).toHaveLength(0);
  });

  it("creates the goal with its period as UTC-midnight calendar dates", async () => {
    const { onOpenChange } = renderForm();
    fireEvent.change(input(/^Title/), { target: { value: " Ten this year " } });
    fireEvent.change(input(/^Target completions/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await vi.waitFor(() => expect(calls.create).toHaveLength(1));
    expect(calls.create[0]).toEqual({
      title: "Ten this year",
      description: undefined,
      targetCompletions: 10,
      startDate: Date.UTC(2026, 0, 1),
      targetDate: Date.UTC(2026, 11, 31),
    });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Goal created");
  });

  it("puts a period the server refuses on the end date instead of a generic error", async () => {
    calls.reject = new ConvexError({
      code: "InvalidGoalPeriod",
      message: "A goal's start date must be on or before its target date",
    });
    const { onOpenChange } = renderForm();
    fireEvent.change(input(/^Title/), { target: { value: "Ten" } });
    fireEvent.change(input(/^Target completions/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await vi.waitFor(() =>
      expect(errorOf(input("To"))).toBe(
        "The end date can't be before the start date.",
      ),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("GoalFormDialog: edit", () => {
  it("says when an older goal's wording is over the limit, on the field to shorten", async () => {
    const { onOpenChange } = renderForm({
      goal: {
        ...GOAL,
        title: "x".repeat(101),
        description: "y".repeat(1001),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() =>
      expect(errorOf(input(/^Title/))).toBe(
        "Keep the title to 100 characters.",
      ),
    );
    expect(errorOf(input("Description"))).toBe(
      "Keep the description to 1000 characters.",
    );
    expect(document.activeElement).toBe(input(/^Title/));
    expect(calls.update).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.change(input("Description"), { target: { value: "short" } });
    expect(errorOf(input("Description"))).toBeUndefined();
  });

  it("stops typing at the limits", () => {
    renderForm({ goal: GOAL });
    expect(input(/^Title/).getAttribute("maxlength")).toBe("100");
    expect(input("Description").getAttribute("maxlength")).toBe("1000");
  });

  it("opens prefilled with the goal and sends the whole definition back", async () => {
    renderForm({ goal: GOAL });
    const dialog = screen.getByRole("dialog", { name: "Edit goal" });
    expect(input(/^Title/).value).toBe("Ten big ones");
    expect(
      (within(dialog).getByLabelText("Description") as HTMLTextAreaElement)
        .value,
    ).toBe("1000 pieces or more");
    expect(input(/^Target completions/).value).toBe("10");
    expect(input("From").value).toBe("2026-01-01");
    expect(input("To").value).toBe("2026-12-31");

    fireEvent.change(input(/^Target completions/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(calls.update).toHaveLength(1));
    expect(calls.update[0]).toEqual({
      goalId: "goal-1",
      title: "Ten big ones",
      description: "1000 pieces or more",
      targetCompletions: 12,
      startDate: Date.UTC(2026, 0, 1),
      targetDate: Date.UTC(2026, 11, 31),
    });
    expect(toast.success).toHaveBeenCalledWith("Goal updated");
  });

  it("lets an ended goal keep its past end date", async () => {
    renderForm({
      goal: {
        ...GOAL,
        startDate: Date.UTC(2025, 0, 1),
        targetDate: Date.UTC(2025, 11, 31),
      },
    });
    expect(input("To").getAttribute("min")).toBe("2025-01-01");
    fireEvent.change(input(/^Title/), { target: { value: "Last year" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(calls.update).toHaveLength(1));
    expect(calls.update[0]).toMatchObject({
      title: "Last year",
      targetDate: Date.UTC(2025, 11, 31),
    });
  });
});

describe("GoalFormDialog in Dutch", () => {
  it("labels the fields and explains errors in natural Dutch", () => {
    renderForm({}, "nl");
    expect(screen.getByRole("dialog", { name: "Doel aanmaken" })).toBeDefined();
    expect(screen.getByText("Velden met * zijn verplicht.")).toBeDefined();
    expect(input("Van").value).toBe("2026-01-01");
    expect(input("Tot en met").value).toBe("2026-12-31");
    fireEvent.change(input(/^Doelaantal voltooiingen/), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Doel aanmaken" }));
    expect(errorOf(input(/^Titel/))).toBe("Geef je doel een titel.");
    expect(errorOf(input(/^Doelaantal voltooiingen/))).toBe(
      "Gebruik een heel getal van 1 of meer.",
    );
  });
});
