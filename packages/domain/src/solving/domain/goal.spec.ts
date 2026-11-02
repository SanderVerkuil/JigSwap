import { describe, expect, it } from "vitest";
import { toGoalId, toMemberId } from "../../shared-kernel";
import { DatePrecision } from "./date-precision";
import {
  Goal,
  GoalDefinition,
  MAX_GOAL_DESCRIPTION_LENGTH,
  MAX_GOAL_TITLE_LENGTH,
} from "./goal";
import { GoalSolve } from "./goal-progress";

const ID = toGoalId("goal-1");
const ALICE = toMemberId("alice");
const NOW = new Date("2026-06-01T10:00:00Z");
const LATER = new Date("2026-06-02T10:00:00Z");

const create = (target: number, extra: Partial<GoalDefinition> = {}) =>
  Goal.create({
    id: ID,
    userId: ALICE,
    title: "Solve 3 puzzles",
    targetCompletions: target,
    now: NOW,
    ...extra,
  });

const fresh = (target = 3, extra: Partial<GoalDefinition> = {}) => {
  const r = create(target, extra);
  if (!r.isOk) throw new Error("setup failed");
  r.value.pullEvents();
  return r.value;
};

const names = (g: Goal) => g.pullEvents().map((e) => e.name);

// `n` solves dated to the day the goal is created (inside its default window).
const solvesToday = (n: number): GoalSolve[] =>
  Array.from({ length: n }, () => ({
    endDate: new Date("2026-06-01T08:00:00Z"),
    datePrecision: "day" as DatePrecision,
  }));
const solveOn = (
  iso: string,
  datePrecision: DatePrecision = "day",
): GoalSolve => ({
  endDate: new Date(iso),
  datePrecision,
});

describe("Goal.create", () => {
  it("creates an active goal at zero progress and records GoalCreated", () => {
    const result = create(3);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.id).toBe(ID);
    expect(result.value.userId).toBe(ALICE);
    expect(result.value.targetCompletions).toBe(3);
    expect(result.value.currentCompletions).toBe(0);
    expect(result.value.isActive).toBe(true);
    expect(result.value.isAchieved).toBe(false);
    expect(names(result.value)).toEqual(["GoalCreated"]);
  });

  it.each([0, -1, 2.5])(
    "rejects target %p with InvalidGoalTarget",
    (target) => {
      const result = create(target);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidGoalTarget");
    },
  );

  it("keeps the period it was given", () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const targetDate = new Date("2026-12-31T00:00:00Z");
    const result = create(3, { startDate, targetDate });
    if (!result.isOk) throw new Error("expected ok");
    expect(result.value.toState().startDate).toBe(startDate);
    expect(result.value.toState().targetDate).toBe(targetDate);
  });

  it("rejects a start date after the target date with InvalidGoalPeriod", () => {
    const result = create(3, {
      startDate: new Date("2026-12-31T00:00:00Z"),
      targetDate: new Date("2026-12-30T00:00:00Z"),
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidGoalPeriod");
  });

  it("rejects a target date before the day it is created when it has no start date", () => {
    const result = create(3, {
      targetDate: new Date("2026-05-31T00:00:00Z"),
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidGoalPeriod");
  });

  it("accepts a one-day period (start and target on the same day)", () => {
    const result = create(3, {
      startDate: new Date("2026-06-01T00:00:00Z"),
      targetDate: new Date("2026-06-01T00:00:00Z"),
    });
    expect(result.isOk).toBe(true);
  });

  it("accepts a target date on the day it is created", () => {
    expect(
      create(3, { targetDate: new Date("2026-06-01T00:00:00Z") }).isOk,
    ).toBe(true);
  });
});

describe("what a goal definition may hold", () => {
  const define = (extra: Partial<GoalDefinition>): GoalDefinition => ({
    title: "Solve 3 puzzles",
    targetCompletions: 3,
    ...extra,
  });
  const expectRefused = (definition: GoalDefinition, code: string) => {
    const created = create(definition.targetCompletions, definition);
    expect(created.isErr && created.error.code).toBe(code);

    const goal = fresh();
    const before = goal.toState();
    const edited = goal.edit(definition, LATER);
    expect(edited.isErr && edited.error.code).toBe(code);
    expect(goal.toState()).toBe(before);
  };
  const expectAccepted = (definition: GoalDefinition) => {
    expect(create(definition.targetCompletions, definition).isOk).toBe(true);
    expect(fresh().edit(definition, LATER).isOk).toBe(true);
  };

  it.each(["", "   ", "\n\t", "\u200b"])(
    "refuses the title %j, which shows nothing, with InvalidGoalTitle",
    (title) => expectRefused(define({ title }), "InvalidGoalTitle"),
  );

  it("takes a title up to the limit and refuses a longer one", () => {
    expectAccepted(define({ title: "x".repeat(MAX_GOAL_TITLE_LENGTH) }));
    expectRefused(
      define({ title: "x".repeat(MAX_GOAL_TITLE_LENGTH + 1) }),
      "InvalidGoalTitle",
    );
  });

  it("takes a description up to the limit and refuses a longer one", () => {
    expectAccepted(
      define({ description: "x".repeat(MAX_GOAL_DESCRIPTION_LENGTH) }),
    );
    expectRefused(
      define({ description: "x".repeat(MAX_GOAL_DESCRIPTION_LENGTH + 1) }),
      "InvalidGoalDescription",
    );
  });

  it.each([
    ["start date", { startDate: new Date(Number.NaN) }],
    ["target date", { targetDate: new Date(Number.NaN) }],
    ["start date past the end of time", { startDate: new Date(1e20) }],
    // A valid instant, but the day after it can't be represented.
    ["target date at the end of time", { targetDate: new Date(8.64e15) }],
  ])("refuses an invalid %s with InvalidGoalPeriod", (_name, dates) => {
    expectRefused(define(dates), "InvalidGoalPeriod");
  });
});

describe("Goal.countingWindow", () => {
  it("runs from the start date through the target date", () => {
    const goal = fresh(3, {
      startDate: new Date("2026-01-01T00:00:00Z"),
      targetDate: new Date("2026-12-31T00:00:00Z"),
    });
    expect(goal.countingWindow.from.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(goal.countingWindow.toExclusive?.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("starts on the day the goal was created when it has no start date", () => {
    expect(fresh().countingWindow.from.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(fresh().countingWindow.toExclusive).toBeUndefined();
  });
});

describe("Goal.progressFrom", () => {
  it("records GoalProgressed on a change below target", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(2), LATER);
    expect(goal.currentCompletions).toBe(2);
    expect(goal.isAchieved).toBe(false);
    expect(goal.toState().updatedAt).toBe(LATER);
    expect(names(goal)).toEqual(["GoalProgressed"]);
  });

  it("is a no-op (no event) when the count is unchanged", () => {
    const goal = fresh();
    goal.progressFrom([], LATER);
    expect(names(goal)).toEqual([]);
    expect(goal.toState().updatedAt).toBe(NOW);
  });

  it("counts only the solves inside the goal's window", () => {
    const goal = fresh(3, {
      startDate: new Date("2026-01-01T00:00:00Z"),
      targetDate: new Date("2026-12-31T00:00:00Z"),
    });
    goal.progressFrom(
      [
        solveOn("2025-12-31T12:00:00Z"),
        solveOn("2026-03-01T12:00:00Z"),
        solveOn("2026-07-01T12:00:00Z", "year"),
        solveOn("2026-05-01T12:00:00Z", "unknown"),
        solveOn("2027-01-01T00:00:00Z"),
      ],
      NOW,
    );
    expect(goal.currentCompletions).toBe(2);
  });

  it("fires GoalAchieved exactly once on crossing the target", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(3), NOW);
    expect(goal.isAchieved).toBe(true);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });

  it("does not re-fire GoalAchieved on a later progress past the target", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(3), NOW); // crosses → achieved
    goal.pullEvents();
    goal.progressFrom(solvesToday(4), NOW); // already achieved
    expect(names(goal)).toEqual(["GoalProgressed"]);
  });

  it("announces a target only once, even when progress drops below it and crosses again", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(3), NOW);
    goal.pullEvents();
    goal.progressFrom(solvesToday(2), LATER); // a solve moved out of the period or deleted
    expect(names(goal)).toEqual(["GoalProgressed"]);
    expect(goal.isAchieved).toBe(false);
    goal.progressFrom(solvesToday(3), LATER); // and back
    expect(names(goal)).toEqual(["GoalProgressed"]);
    expect(goal.isAchieved).toBe(true);
  });

  it("remembers the announcement across a save", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(3), NOW);
    goal.pullEvents();
    const restored = Goal.rehydrate(goal.toState());
    restored.progressFrom(solvesToday(2), LATER);
    restored.progressFrom(solvesToday(3), LATER);
    expect(names(restored)).toEqual(["GoalProgressed", "GoalProgressed"]);
  });

  it("announces a new target after an edit changes it", () => {
    const goal = fresh(3);
    goal.progressFrom(solvesToday(3), NOW);
    goal.pullEvents();
    goal.edit({ title: "More", targetCompletions: 5 }, LATER);
    goal.progressFrom(solvesToday(5), LATER);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });

  it("keeps the announcement when an edit leaves the target alone", () => {
    const goal = fresh(3);
    goal.progressFrom(solvesToday(3), NOW);
    goal.pullEvents();
    goal.edit({ title: "Renamed", targetCompletions: 3 }, LATER);
    goal.progressFrom(solvesToday(2), LATER);
    goal.progressFrom(solvesToday(3), LATER);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalProgressed"]);
  });

  it("fires GoalAchieved when progress jumps straight past the target", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(10), NOW);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });

  it("carries the new count and the target on its events", () => {
    const goal = fresh();
    goal.progressFrom(solvesToday(3), LATER);
    const [progressed, achieved] = goal.pullEvents();
    expect(progressed).toMatchObject({
      goalId: ID,
      userId: ALICE,
      currentCompletions: 3,
      targetCompletions: 3,
      occurredAt: LATER,
    });
    expect(achieved).toMatchObject({
      goalId: ID,
      userId: ALICE,
      targetCompletions: 3,
      occurredAt: LATER,
    });
  });
});

describe("Goal.recount", () => {
  it("corrects the count silently, without GoalProgressed or GoalAchieved", () => {
    const goal = fresh();
    goal.recount(solvesToday(5), LATER);
    expect(goal.currentCompletions).toBe(5);
    expect(goal.isAchieved).toBe(true);
    expect(goal.toState().updatedAt).toBe(LATER);
    expect(names(goal)).toEqual([]);
  });

  it("lowers a count that included solves outside the window", () => {
    const goal = Goal.rehydrate({
      ...fresh().toState(),
      currentCompletions: 31,
    });
    goal.recount([solveOn("2020-01-01T00:00:00Z"), ...solvesToday(1)], LATER);
    expect(goal.currentCompletions).toBe(1);
    expect(names(goal)).toEqual([]);
  });

  it("leaves the goal untouched when the count is already right", () => {
    const goal = fresh();
    const before = goal.toState();
    goal.recount([], LATER);
    expect(goal.toState()).toBe(before);
  });

  it("lets a later completion-driven crossing still announce GoalAchieved", () => {
    const goal = fresh();
    goal.recount(solvesToday(2), NOW);
    goal.progressFrom(solvesToday(3), LATER);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });
});

describe("Goal.edit", () => {
  const definition: GoalDefinition = {
    title: "Solve 12 in 2026",
    description: "One a month",
    targetCompletions: 12,
    startDate: new Date("2026-01-01T00:00:00Z"),
    targetDate: new Date("2026-12-31T00:00:00Z"),
  };

  it("replaces the definition and records no event", () => {
    const goal = fresh();
    const outcome = goal.edit(definition, LATER);
    expect(outcome.isOk).toBe(true);
    expect(goal.toState()).toEqual({
      ...definition,
      id: ID,
      userId: ALICE,
      currentCompletions: 0,
      isActive: true,
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(names(goal)).toEqual([]);
  });

  it("clears the fields the new definition leaves out", () => {
    const goal = fresh(3, {
      description: "old",
      startDate: new Date("2026-01-01T00:00:00Z"),
      targetDate: new Date("2026-12-31T00:00:00Z"),
    });
    goal.edit({ title: "Plain", targetCompletions: 3 }, LATER);
    const state = goal.toState();
    expect(state.title).toBe("Plain");
    expect(state.description).toBeUndefined();
    expect(state.startDate).toBeUndefined();
    expect(state.targetDate).toBeUndefined();
  });

  it.each([0, -2, 1.5])(
    "rejects target %p with InvalidGoalTarget and keeps the goal",
    (target) => {
      const goal = fresh();
      const before = goal.toState();
      const outcome = goal.edit(
        { ...definition, targetCompletions: target },
        LATER,
      );
      expect(outcome.isErr).toBe(true);
      if (outcome.isErr) expect(outcome.error.code).toBe("InvalidGoalTarget");
      expect(goal.toState()).toBe(before);
    },
  );

  it("rejects a start date after the target date with InvalidGoalPeriod", () => {
    const goal = fresh();
    const before = goal.toState();
    const outcome = goal.edit(
      { ...definition, startDate: new Date("2027-01-01T00:00:00Z") },
      LATER,
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidGoalPeriod");
    expect(goal.toState()).toBe(before);
  });

  it("measures a period without a start date from the day the goal was created", () => {
    const goal = fresh();
    const outcome = goal.edit(
      {
        title: "x",
        targetCompletions: 1,
        targetDate: new Date("2026-05-31T00:00:00Z"),
      },
      LATER,
    );
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidGoalPeriod");
  });
});

describe("Goal.archive / restore", () => {
  it("archives an active goal and records no event", () => {
    const goal = fresh();
    goal.archive(LATER);
    expect(goal.isActive).toBe(false);
    expect(goal.toState().updatedAt).toBe(LATER);
    expect(names(goal)).toEqual([]);
  });

  it("archiving an archived goal changes nothing", () => {
    const goal = fresh();
    goal.archive(NOW);
    const before = goal.toState();
    goal.archive(LATER);
    expect(goal.toState()).toBe(before);
  });

  it("restores an archived goal", () => {
    const goal = fresh();
    goal.archive(NOW);
    goal.restore(LATER);
    expect(goal.isActive).toBe(true);
    expect(goal.toState().updatedAt).toBe(LATER);
    expect(names(goal)).toEqual([]);
  });

  it("restoring an active goal changes nothing", () => {
    const goal = fresh();
    const before = goal.toState();
    goal.restore(LATER);
    expect(goal.toState()).toBe(before);
  });
});

describe("Goal round-trip", () => {
  it("rehydrates from state without re-emitting events", () => {
    const r = create(3, { startDate: new Date("2026-01-01T00:00:00Z") });
    if (!r.isOk) throw new Error("setup failed");
    const state = r.value.toState();
    const rehydrated = Goal.rehydrate(state);
    expect(rehydrated.toState()).toEqual(state);
    expect(rehydrated.pullEvents()).toEqual([]);
  });
});
