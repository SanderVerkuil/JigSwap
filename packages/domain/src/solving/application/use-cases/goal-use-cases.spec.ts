import { beforeEach, describe, expect, it } from "vitest";
import {
  toGoalId,
  toMemberId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import { Goal, GoalId } from "../../domain";
import {
  FixedClock,
  InMemoryCompletionRepository,
  InMemoryGoalRepository,
  RecordingEventPublisher,
  SequentialCompletionIdGenerator,
  SequentialGoalIdGenerator,
} from "../testing";
import { makeCreateGoal } from "./create-goal";
import { makeRecomputeGoalProgress } from "./recompute-goal-progress";
import { makeRecordCompletion } from "./record-completion";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const PUZZLE = toPuzzleDefinitionId("puzzle-1");
const START = new Date("2026-06-01T10:00:00Z");
const END = new Date("2026-06-01T11:30:00Z");
const NOW = new Date("2026-06-01T12:00:00Z");
const THIS_YEAR = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  targetDate: new Date("2026-12-31T00:00:00Z"),
};

describe("Goal use cases", () => {
  let goals: InMemoryGoalRepository;
  let completions: InMemoryCompletionRepository;
  let events: RecordingEventPublisher;
  let clock: FixedClock;
  let completionIds: SequentialCompletionIdGenerator;
  let goalIds: SequentialGoalIdGenerator;

  beforeEach(() => {
    goals = new InMemoryGoalRepository();
    completions = new InMemoryCompletionRepository();
    events = new RecordingEventPublisher();
    clock = new FixedClock(NOW);
    completionIds = new SequentialCompletionIdGenerator();
    goalIds = new SequentialGoalIdGenerator();
  });

  const createGoal = () =>
    makeCreateGoal({ goals, completions, ids: goalIds, events, clock });

  const recompute = () =>
    makeRecomputeGoalProgress({ goals, completions, events, clock });

  const record = () =>
    makeRecordCompletion({ completions, ids: completionIds, events, clock });

  // A finished solve dated to the day; by default today, inside a goal created today.
  const recordCompletion = async (
    startDate: Date = START,
    endDate: Date = END,
  ) => {
    const r = await record()({
      userId: ALICE,
      puzzleDefinitionId: PUZZLE,
      startDate,
      endDate,
    });
    if (!r.isOk) throw new Error("setup failed");
  };

  const recordYearOnly = async (year: number) => {
    const r = await record()({
      userId: ALICE,
      puzzleDefinitionId: PUZZLE,
      datePrecision: "year",
      year,
    });
    if (!r.isOk) throw new Error("setup failed");
  };

  const seedGoal = async (
    target: number,
    period: { startDate?: Date; targetDate?: Date } = {},
  ): Promise<GoalId> => {
    const result = await createGoal()({
      userId: ALICE,
      title: `Solve ${target}`,
      targetCompletions: target,
      ...period,
    });
    if (!result.isOk) throw new Error("setup failed");
    return result.value;
  };

  const stored = async (id: GoalId) => {
    const goal = await goals.findById(id);
    if (!goal) throw new Error("goal missing");
    return goal;
  };

  describe("createGoal", () => {
    it("persists a goal and publishes GoalCreated", async () => {
      const result = await createGoal()({
        userId: ALICE,
        title: "Solve 2",
        targetCompletions: 2,
      });
      expect(result.isOk).toBe(true);
      expect(goals.size()).toBe(1);
      expect(events.names()).toEqual(["GoalCreated"]);
    });

    it("rejects a non-positive target with InvalidGoalTarget", async () => {
      const result = await createGoal()({
        userId: ALICE,
        title: "bad",
        targetCompletions: 0,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidGoalTarget");
      expect(goals.size()).toBe(0);
    });

    it("rejects a period that ends before it starts with InvalidGoalPeriod", async () => {
      const result = await createGoal()({
        userId: ALICE,
        title: "bad",
        targetCompletions: 3,
        startDate: THIS_YEAR.targetDate,
        targetDate: THIS_YEAR.startDate,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidGoalPeriod");
      expect(goals.size()).toBe(0);
    });

    it("keeps its period", async () => {
      const id = await seedGoal(3, THIS_YEAR);
      expect((await stored(id)).toState()).toMatchObject(THIS_YEAR);
    });

    it("does not count solves from before it started: 30 earlier solves give 0/10", async () => {
      for (let day = 1; day <= 30; day++) {
        const finished = new Date(Date.UTC(2026, 3, day, 20));
        await recordCompletion(finished, finished);
      }
      await recordYearOnly(2025);

      const id = await seedGoal(10);
      expect((await stored(id)).currentCompletions).toBe(0);

      // The next solve brings it to 1/10, not 31/10, and announces nothing yet.
      await recordCompletion();
      events.published.length = 0;
      await recompute()({ userId: ALICE });
      expect((await stored(id)).currentCompletions).toBe(1);
      expect(events.names()).toEqual(["GoalProgressed"]);
    });

    it("starts a this-year goal at this year's solves, silently", async () => {
      await recordCompletion(
        new Date("2026-02-01T10:00:00Z"),
        new Date("2026-02-01T12:00:00Z"),
      );
      await recordCompletion(
        new Date("2026-03-01T10:00:00Z"),
        new Date("2026-03-01T12:00:00Z"),
      );
      await recordYearOnly(2026);
      await recordCompletion(
        new Date("2025-12-31T10:00:00Z"),
        new Date("2025-12-31T12:00:00Z"),
      );
      await recordYearOnly(2025);
      const undated = await record()({
        userId: ALICE,
        puzzleDefinitionId: PUZZLE,
        datePrecision: "unknown",
      });
      expect(undated.isOk).toBe(true);
      events.published.length = 0;

      const id = await seedGoal(3, THIS_YEAR);
      const goal = await stored(id);
      expect(goal.currentCompletions).toBe(3);
      expect(goal.isAchieved).toBe(true);
      // Already met at creation: no GoalProgressed, no GoalAchieved.
      expect(events.names()).toEqual(["GoalCreated"]);
    });

    it("counts only the creator's solves", async () => {
      const r = await record()({
        userId: BOB,
        puzzleDefinitionId: PUZZLE,
        startDate: START,
        endDate: END,
      });
      expect(r.isOk).toBe(true);
      const id = await seedGoal(3);
      expect((await stored(id)).currentCompletions).toBe(0);
    });
  });

  describe("recomputeGoalProgress (derived from completions)", () => {
    it("derives current progress from the solves in the goal's period and publishes GoalProgressed", async () => {
      const goalId = await seedGoal(2);
      await recordCompletion();
      events.published.length = 0;

      const result = await recompute()({ userId: ALICE });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["GoalProgressed"]);

      const goal = await stored(goalId);
      expect(goal.currentCompletions).toBe(1);
      expect(goal.isAchieved).toBe(false);
    });

    it("fires GoalAchieved once when the count crosses the target", async () => {
      await seedGoal(2);
      await recordCompletion();
      await recordCompletion();
      events.published.length = 0;

      await recompute()({ userId: ALICE });
      expect(events.names()).toEqual(["GoalProgressed", "GoalAchieved"]);
    });

    it("does not re-fire GoalAchieved on a later recompute past the target", async () => {
      await seedGoal(2);
      await recordCompletion();
      await recordCompletion();
      await recompute()({ userId: ALICE }); // achieved here
      await recordCompletion(); // now 3
      events.published.length = 0;
      await recompute()({ userId: ALICE });
      expect(events.names()).toEqual(["GoalProgressed"]);
      expect(events.countOf("GoalAchieved")).toBe(0);
    });

    it("is a no-op (no events, no publish) when the count is unchanged", async () => {
      await seedGoal(2);
      await recordCompletion();
      await recompute()({ userId: ALICE });
      events.published.length = 0;
      events.batches.length = 0;
      await recompute()({ userId: ALICE }); // still 1
      expect(events.published).toHaveLength(0);
      // publish is not even called when a goal records no events.
      expect(events.batches).toHaveLength(0);
    });

    it("gives each goal the count of its own period", async () => {
      const thisYear = await seedGoal(5, THIS_YEAR);
      const fromToday = await seedGoal(5);
      await recordCompletion(
        new Date("2026-02-01T10:00:00Z"),
        new Date("2026-02-01T12:00:00Z"),
      );
      await recordCompletion();

      await recompute()({ userId: ALICE });
      expect((await stored(thisYear)).currentCompletions).toBe(2);
      expect((await stored(fromToday)).currentCompletions).toBe(1);
    });

    it("skips inactive goals (no progress derived for them)", async () => {
      const inactiveId = toGoalId("inactive-1");
      await goals.save(
        Goal.rehydrate({
          id: inactiveId,
          userId: ALICE,
          title: "retired",
          targetCompletions: 2,
          currentCompletions: 0,
          isActive: false,
          createdAt: START,
          updatedAt: START,
        }),
      );
      await recordCompletion();
      events.published.length = 0;

      await recompute()({ userId: ALICE });

      expect((await stored(inactiveId)).currentCompletions).toBe(0); // untouched
      expect(events.published).toHaveLength(0);
    });

    it("ignores undated solves and year-only solves from other years (decision 4)", async () => {
      const goalId = await seedGoal(5);
      await recordCompletion();
      await recordYearOnly(2026);
      await recordYearOnly(2023);
      await record()({
        userId: ALICE,
        puzzleDefinitionId: PUZZLE,
        datePrecision: "unknown",
      });

      await recompute()({ userId: ALICE });
      expect((await stored(goalId)).currentCompletions).toBe(2);
    });
  });
});
