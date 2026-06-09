import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { Goal } from "./goal";
import { GoalId, MemberId } from "./ids";

const ID = toId<"GoalId">("goal-1") as GoalId;
const ALICE = toId<"MemberId">("alice") as MemberId;
const NOW = new Date("2026-06-01T10:00:00Z");

const create = (target: number) =>
  Goal.create({
    id: ID,
    userId: ALICE,
    title: "Solve 3 puzzles",
    targetCompletions: target,
    now: NOW,
  });

const names = (g: Goal) => g.pullEvents().map((e) => e.name);

describe("Goal.create", () => {
  it("creates an active goal at zero progress and records GoalCreated", () => {
    const result = create(3);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.currentCompletions).toBe(0);
    expect(result.value.isActive).toBe(true);
    expect(result.value.isAchieved).toBe(false);
    expect(names(result.value)).toEqual(["GoalCreated"]);
  });

  it.each([0, -1, 2.5])("rejects target %p with InvalidGoalTarget", (target) => {
    const result = create(target);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidGoalTarget");
  });
});

describe("Goal.progressTo", () => {
  const fresh = () => {
    const r = create(3);
    if (!r.isOk) throw new Error("setup failed");
    r.value.pullEvents();
    return r.value;
  };

  it("records GoalProgressed on a change below target", () => {
    const goal = fresh();
    const outcome = goal.progressTo(2, NOW);
    expect(outcome.isOk).toBe(true);
    expect(goal.currentCompletions).toBe(2);
    expect(goal.isAchieved).toBe(false);
    expect(names(goal)).toEqual(["GoalProgressed"]);
  });

  it("is a no-op (no event) when the count is unchanged", () => {
    const goal = fresh();
    const outcome = goal.progressTo(0, NOW);
    expect(outcome.isOk).toBe(true);
    expect(names(goal)).toEqual([]);
  });

  it("fires GoalAchieved exactly once on crossing the target", () => {
    const goal = fresh();
    const outcome = goal.progressTo(3, NOW);
    expect(outcome.isOk).toBe(true);
    expect(goal.isAchieved).toBe(true);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });

  it("does not re-fire GoalAchieved on a later progress past the target", () => {
    const goal = fresh();
    goal.progressTo(3, NOW); // crosses → achieved
    goal.pullEvents();
    const outcome = goal.progressTo(4, NOW); // already achieved
    expect(outcome.isOk).toBe(true);
    expect(names(goal)).toEqual(["GoalProgressed"]);
  });

  it("fires GoalAchieved when progress jumps straight past the target", () => {
    const goal = fresh();
    const outcome = goal.progressTo(10, NOW);
    expect(outcome.isOk).toBe(true);
    expect(names(goal)).toEqual(["GoalProgressed", "GoalAchieved"]);
  });

  it("rejects a negative count with InvalidGoalTarget", () => {
    const goal = fresh();
    const outcome = goal.progressTo(-1, NOW);
    expect(outcome.isErr).toBe(true);
    if (outcome.isErr) expect(outcome.error.code).toBe("InvalidGoalTarget");
  });
});

describe("Goal round-trip", () => {
  it("rehydrates from state without re-emitting events", () => {
    const r = create(3);
    if (!r.isOk) throw new Error("setup failed");
    const state = r.value.toState();
    const rehydrated = Goal.rehydrate(state);
    expect(rehydrated.toState()).toEqual(state);
    expect(rehydrated.pullEvents()).toEqual([]);
  });
});
