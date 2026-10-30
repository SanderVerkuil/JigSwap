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
import { makeDeleteGoal } from "./delete-goal";
import { makeRecomputeGoalProgress } from "./recompute-goal-progress";
import { makeRecordCompletion } from "./record-completion";
import { makeSetGoalArchived } from "./set-goal-archived";
import { makeUpdateGoal } from "./update-goal";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const PUZZLE = toPuzzleDefinitionId("puzzle-1");
const START = new Date("2026-06-01T10:00:00Z");
const END = new Date("2026-06-01T11:30:00Z");
const NOW = new Date("2026-06-01T12:00:00Z");
const LATER = new Date("2026-06-03T12:00:00Z");
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

  describe("updateGoal", () => {
    const update = () => makeUpdateGoal({ goals, completions, clock });

    it("replaces the definition and recounts for the new period without announcing anything", async () => {
      await recordCompletion(
        new Date("2026-02-01T10:00:00Z"),
        new Date("2026-02-01T12:00:00Z"),
      );
      await recordCompletion(
        new Date("2026-03-01T10:00:00Z"),
        new Date("2026-03-01T12:00:00Z"),
      );
      const id = await seedGoal(5);
      expect((await stored(id)).currentCompletions).toBe(0);
      events.published.length = 0;
      clock.set(LATER);

      const result = await update()({
        actingMemberId: ALICE,
        goalId: id,
        title: "Two this year",
        targetCompletions: 2,
        ...THIS_YEAR,
      });
      expect(result.isOk).toBe(true);
      const goal = await stored(id);
      expect(goal.toState()).toMatchObject({
        title: "Two this year",
        targetCompletions: 2,
        currentCompletions: 2,
        updatedAt: LATER,
        ...THIS_YEAR,
      });
      expect(goal.isAchieved).toBe(true);
      expect(events.published).toHaveLength(0);
    });

    it("recounts an archived goal without restoring it", async () => {
      await recordCompletion(
        new Date("2026-02-01T10:00:00Z"),
        new Date("2026-02-01T12:00:00Z"),
      );
      const id = await seedGoal(5);
      await makeSetGoalArchived({ goals, completions, clock })({
        actingMemberId: ALICE,
        goalId: id,
        archived: true,
      });

      await update()({
        actingMemberId: ALICE,
        goalId: id,
        title: "Five",
        targetCompletions: 5,
        ...THIS_YEAR,
      });
      const goal = await stored(id);
      expect(goal.isActive).toBe(false);
      expect(goal.currentCompletions).toBe(1);
    });

    it("refuses another member's goal with NotGoalOwner and keeps it", async () => {
      const id = await seedGoal(5);
      const before = (await stored(id)).toState();
      const result = await update()({
        actingMemberId: BOB,
        goalId: id,
        title: "Mine now",
        targetCompletions: 1,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotGoalOwner");
      expect((await stored(id)).toState()).toEqual(before);
    });

    it("reports GoalNotFound for an unknown goal", async () => {
      const result = await update()({
        actingMemberId: ALICE,
        goalId: toGoalId("missing"),
        title: "x",
        targetCompletions: 1,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("GoalNotFound");
    });

    it("rejects an invalid target with InvalidGoalTarget and keeps the goal", async () => {
      const id = await seedGoal(5);
      const before = (await stored(id)).toState();
      const result = await update()({
        actingMemberId: ALICE,
        goalId: id,
        title: "x",
        targetCompletions: 2.5,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidGoalTarget");
      expect((await stored(id)).toState()).toEqual(before);
    });
  });

  describe("setGoalArchived", () => {
    const setArchived = () =>
      makeSetGoalArchived({ goals, completions, clock });

    it("archives the goal, which then stops following new solves", async () => {
      const id = await seedGoal(5);
      clock.set(LATER);
      const result = await setArchived()({
        actingMemberId: ALICE,
        goalId: id,
        archived: true,
      });
      expect(result.isOk).toBe(true);
      const goal = await stored(id);
      expect(goal.isActive).toBe(false);
      expect(goal.toState().updatedAt).toBe(LATER);

      await recordCompletion();
      await recompute()({ userId: ALICE });
      expect((await stored(id)).currentCompletions).toBe(0);
    });

    it("restores the goal and silently counts the solves it missed", async () => {
      const id = await seedGoal(1);
      await setArchived()({
        actingMemberId: ALICE,
        goalId: id,
        archived: true,
      });
      await recordCompletion();
      await recompute()({ userId: ALICE });
      events.published.length = 0;

      const result = await setArchived()({
        actingMemberId: ALICE,
        goalId: id,
        archived: false,
      });
      expect(result.isOk).toBe(true);
      const goal = await stored(id);
      expect(goal.isActive).toBe(true);
      expect(goal.currentCompletions).toBe(1);
      expect(events.published).toHaveLength(0);
    });

    it("refuses another member's goal with NotGoalOwner", async () => {
      const id = await seedGoal(5);
      const result = await setArchived()({
        actingMemberId: BOB,
        goalId: id,
        archived: true,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotGoalOwner");
      expect((await stored(id)).isActive).toBe(true);
    });

    it("reports GoalNotFound for an unknown goal", async () => {
      const result = await setArchived()({
        actingMemberId: ALICE,
        goalId: toGoalId("missing"),
        archived: true,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("GoalNotFound");
    });
  });

  describe("deleteGoal", () => {
    const remove = () => makeDeleteGoal({ goals });

    it("deletes the owner's goal", async () => {
      const id = await seedGoal(5);
      const result = await remove()({ actingMemberId: ALICE, goalId: id });
      expect(result.isOk).toBe(true);
      expect(await goals.findById(id)).toBeNull();
    });

    it("refuses another member's goal with NotGoalOwner and keeps it", async () => {
      const id = await seedGoal(5);
      const result = await remove()({ actingMemberId: BOB, goalId: id });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotGoalOwner");
      expect(goals.size()).toBe(1);
    });

    it("reports GoalNotFound for an unknown goal", async () => {
      const result = await remove()({
        actingMemberId: ALICE,
        goalId: toGoalId("missing"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("GoalNotFound");
    });
  });
});
