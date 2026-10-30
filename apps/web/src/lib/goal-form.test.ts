import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentGoals,
  defaultGoalPeriod,
  goalFormErrorsFromCode,
  goalFormValues,
  goalStatus,
  minGoalEndDate,
  parseTarget,
  validateGoalForm,
  type GoalFormValues,
} from "./goal-form";

// Goal dates are calendar dates stored as UTC midnight (lib/date-input). "Today" is the member's
// local calendar day, so every rule here must give the same answer on both sides of UTC.
const ZONES = [
  "UTC",
  "Europe/Amsterdam",
  "Pacific/Auckland",
  "America/Los_Angeles",
];

const valid = (overrides: Partial<GoalFormValues> = {}): GoalFormValues => ({
  title: "Solve 10 puzzles",
  description: "",
  target: "10",
  from: "2026-01-01",
  to: "2026-12-31",
  ...overrides,
});

describe("parseTarget", () => {
  it("accepts a positive whole number", () => {
    expect(parseTarget("10")).toEqual({ ok: true, value: 10 });
    expect(parseTarget(" 1 ")).toEqual({ ok: true, value: 1 });
  });

  it("asks for a number when the field is empty", () => {
    expect(parseTarget("")).toEqual({ ok: false, error: "required" });
    expect(parseTarget("   ")).toEqual({ ok: false, error: "required" });
  });

  it("refuses zero, fractions, negatives and non-numbers the server would reject", () => {
    for (const raw of [
      "0",
      "2.5",
      "-3",
      "1e3",
      "abc",
      "00",
      "99999999999999999999",
    ]) {
      expect(parseTarget(raw)).toEqual({ ok: false, error: "invalid" });
    }
  });
});

describe.each(ZONES)("goal dates in %s", (zone) => {
  beforeEach(() => {
    vi.stubEnv("TZ", zone);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults the period to this calendar year", () => {
    expect(defaultGoalPeriod(new Date(2026, 9, 30, 12))).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    // Just after local midnight on New Year's day it is already the new year.
    expect(defaultGoalPeriod(new Date(2027, 0, 1, 0, 5))).toEqual({
      from: "2027-01-01",
      to: "2027-12-31",
    });
  });

  it("keeps a goal active through the whole of its last day, then ends it", () => {
    const goal = {
      isActive: true,
      isAchieved: false,
      targetDate: Date.UTC(2026, 11, 31),
    };
    expect(goalStatus(goal, new Date(2026, 11, 31, 0, 5))).toBe("active");
    expect(goalStatus(goal, new Date(2026, 11, 31, 23, 55))).toBe("active");
    expect(goalStatus(goal, new Date(2027, 0, 1, 0, 5))).toBe("ended");
  });

  it("refuses an end date before today when creating, but allows today", () => {
    const now = new Date(2026, 9, 30, 0, 30);
    expect(
      validateGoalForm(valid({ from: "", to: "2026-10-29" }), {
        mode: "create",
        now,
      }),
    ).toEqual({ ok: false, errors: { to: "past" } });
    expect(
      validateGoalForm(valid({ from: "", to: "2026-10-30" }), {
        mode: "create",
        now,
      }).ok,
    ).toBe(true);
  });

  it("sends the picked dates as UTC midnight", () => {
    expect(
      validateGoalForm(valid(), { mode: "create", now: new Date(2026, 9, 30) }),
    ).toEqual({
      ok: true,
      definition: {
        title: "Solve 10 puzzles",
        description: undefined,
        targetCompletions: 10,
        startDate: Date.UTC(2026, 0, 1),
        targetDate: Date.UTC(2026, 11, 31),
      },
    });
  });

  it("offers the later of today and the start date as the earliest end date on create", () => {
    const now = new Date(2026, 9, 30, 0, 30);
    expect(minGoalEndDate(valid({ from: "2026-01-01" }), "create", now)).toBe(
      "2026-10-30",
    );
    expect(minGoalEndDate(valid({ from: "2026-11-15" }), "create", now)).toBe(
      "2026-11-15",
    );
    expect(minGoalEndDate(valid({ from: "" }), "create", now)).toBe(
      "2026-10-30",
    );
  });
});

describe("goalStatus", () => {
  const now = new Date(2026, 9, 30, 12);
  const past = Date.UTC(2026, 0, 31);

  it("is active while the goal is live, unmet and not past its end", () => {
    expect(goalStatus({ isActive: true, isAchieved: false }, now)).toBe(
      "active",
    );
    expect(
      goalStatus(
        {
          isActive: true,
          isAchieved: false,
          targetDate: Date.UTC(2026, 11, 31),
        },
        now,
      ),
    ).toBe("active");
  });

  it("is ended once the last day has passed without reaching the target", () => {
    expect(
      goalStatus({ isActive: true, isAchieved: false, targetDate: past }, now),
    ).toBe("ended");
  });

  it("stays achieved after its end date: reaching it is what counts", () => {
    expect(
      goalStatus({ isActive: true, isAchieved: true, targetDate: past }, now),
    ).toBe("achieved");
  });

  it("is archived whenever the member archived it, achieved or not", () => {
    expect(goalStatus({ isActive: false, isAchieved: true }, now)).toBe(
      "archived",
    );
    expect(
      goalStatus({ isActive: false, isAchieved: false, targetDate: past }, now),
    ).toBe("archived");
  });
});

describe("validateGoalForm", () => {
  const now = new Date(2026, 9, 30, 12);

  it("reports every missing or invalid field at once", () => {
    expect(
      validateGoalForm(valid({ title: "  ", target: "" }), {
        mode: "create",
        now,
      }),
    ).toEqual({ ok: false, errors: { title: "required", target: "required" } });
    expect(
      validateGoalForm(valid({ target: "2.5" }), { mode: "create", now }),
    ).toEqual({ ok: false, errors: { target: "invalid" } });
    expect(
      validateGoalForm(valid({ target: "0" }), { mode: "create", now }),
    ).toEqual({ ok: false, errors: { target: "invalid" } });
  });

  it("refuses an end date before the start date", () => {
    expect(
      validateGoalForm(valid({ from: "2026-12-01", to: "2026-11-30" }), {
        mode: "create",
        now,
      }),
    ).toEqual({ ok: false, errors: { to: "beforeFrom" } });
    // Also when editing, where a past end date is otherwise fine.
    expect(
      validateGoalForm(valid({ from: "2025-12-01", to: "2025-11-30" }), {
        mode: "edit",
        now,
      }),
    ).toEqual({ ok: false, errors: { to: "beforeFrom" } });
  });

  it("allows a one-day period", () => {
    expect(
      validateGoalForm(valid({ from: "2026-11-30", to: "2026-11-30" }), {
        mode: "create",
        now,
      }).ok,
    ).toBe(true);
  });

  it("lets an edit keep an end date in the past (renaming an ended goal)", () => {
    expect(
      validateGoalForm(valid({ from: "2025-01-01", to: "2025-12-31" }), {
        mode: "edit",
        now,
      }).ok,
    ).toBe(true);
  });

  it("trims the wording and leaves empty optional fields out", () => {
    expect(
      validateGoalForm(
        valid({ title: "  Ten  ", description: "  ", from: "", to: "" }),
        { mode: "create", now },
      ),
    ).toEqual({
      ok: true,
      definition: {
        title: "Ten",
        description: undefined,
        targetCompletions: 10,
        startDate: undefined,
        targetDate: undefined,
      },
    });
    expect(
      validateGoalForm(valid({ description: " Big ones " }), {
        mode: "edit",
        now,
      }),
    ).toMatchObject({ ok: true, definition: { description: "Big ones" } });
  });

  it("only bounds the end date by the start date when editing", () => {
    expect(minGoalEndDate(valid({ from: "2025-01-01" }), "edit", now)).toBe(
      "2025-01-01",
    );
    expect(minGoalEndDate(valid({ from: "" }), "edit", now)).toBeUndefined();
  });
});

describe("goalFormValues", () => {
  it("starts a new goal empty, over this calendar year", () => {
    expect(goalFormValues(undefined, new Date(2026, 9, 30, 12))).toEqual({
      title: "",
      description: "",
      target: "",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("prefills an edit with the goal's own definition", () => {
    expect(
      goalFormValues({
        title: "Ten",
        description: "Big ones",
        targetCompletions: 10,
        startDate: Date.UTC(2026, 0, 1),
        targetDate: Date.UTC(2026, 11, 31),
        createdAt: Date.UTC(2026, 2, 3, 15),
      }),
    ).toEqual({
      title: "Ten",
      description: "Big ones",
      target: "10",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("shows a goal set before periods existed as counting from the day it was created", () => {
    expect(
      goalFormValues({
        title: "Ten",
        targetCompletions: 10,
        createdAt: Date.UTC(2026, 2, 3, 15),
      }),
    ).toEqual({
      title: "Ten",
      description: "",
      target: "10",
      from: "2026-03-03",
      to: "",
    });
  });
});

describe("goalFormErrorsFromCode", () => {
  it("puts the server's own refusals on the field they are about", () => {
    expect(goalFormErrorsFromCode("InvalidGoalTarget")).toEqual({
      target: "invalid",
    });
    expect(goalFormErrorsFromCode("InvalidGoalPeriod")).toEqual({
      to: "beforeFrom",
    });
  });

  it("leaves anything else to a generic message", () => {
    expect(goalFormErrorsFromCode("NotGoalOwner")).toBeUndefined();
    expect(goalFormErrorsFromCode(undefined)).toBeUndefined();
  });
});

describe("currentGoals", () => {
  const now = new Date(2026, 9, 30, 12);
  const goal = (
    id: string,
    over: { isActive?: boolean; isAchieved?: boolean; targetDate?: number },
  ) => ({ id, isActive: true, isAchieved: false, ...over });

  it("leads with the goals still being chased, then achieved ones, never ended or archived ones", () => {
    const goals = [
      goal("achieved", { isAchieved: true }),
      goal("archived", { isActive: false }),
      goal("ended", { targetDate: Date.UTC(2026, 0, 31) }),
      goal("chasing", { targetDate: Date.UTC(2026, 11, 31) }),
      goal("open", {}),
    ];
    expect(currentGoals(goals, now).map((g) => g.id)).toEqual([
      "chasing",
      "open",
      "achieved",
    ]);
  });

  it("is empty when every goal is in the past", () => {
    expect(
      currentGoals(
        [
          goal("archived", { isActive: false, isAchieved: true }),
          goal("ended", { targetDate: Date.UTC(2026, 0, 31) }),
        ],
        now,
      ),
    ).toEqual([]);
  });
});
