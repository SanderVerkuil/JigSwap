import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { MemberId } from "../../domain";
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

const ALICE = toId<"MemberId">("alice") as MemberId;
const START = new Date("2026-06-01T10:00:00Z");
const END = new Date("2026-06-01T11:30:00Z");
const NOW = new Date("2026-06-01T12:00:00Z");

describe("Goal use cases", () => {
  let goals: InMemoryGoalRepository;
  let completions: InMemoryCompletionRepository;
  let events: RecordingEventPublisher;
  let clock: FixedClock;
  let completionIds: SequentialCompletionIdGenerator;

  beforeEach(() => {
    goals = new InMemoryGoalRepository();
    completions = new InMemoryCompletionRepository();
    events = new RecordingEventPublisher();
    clock = new FixedClock(NOW);
    completionIds = new SequentialCompletionIdGenerator();
  });

  describe("createGoal", () => {
    it("persists a goal and publishes GoalCreated", async () => {
      const create = makeCreateGoal({
        goals,
        ids: new SequentialGoalIdGenerator(),
        events,
        clock,
      });
      const result = await create({
        userId: ALICE,
        title: "Solve 2",
        targetCompletions: 2,
      });
      expect(result.isOk).toBe(true);
      expect(goals.size()).toBe(1);
      expect(events.names()).toEqual(["GoalCreated"]);
    });

    it("rejects a non-positive target with InvalidGoalTarget", async () => {
      const create = makeCreateGoal({
        goals,
        ids: new SequentialGoalIdGenerator(),
        events,
        clock,
      });
      const result = await create({
        userId: ALICE,
        title: "bad",
        targetCompletions: 0,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidGoalTarget");
    });
  });

  describe("recomputeGoalProgress (derived from completions)", () => {
    const seedGoal = async (target: number) => {
      const create = makeCreateGoal({
        goals,
        ids: new SequentialGoalIdGenerator(),
        events,
        clock,
      });
      const result = await create({
        userId: ALICE,
        title: `Solve ${target}`,
        targetCompletions: target,
      });
      if (!result.isOk) throw new Error("setup failed");
      return result.value;
    };

    const recordCompletion = async () => {
      const record = makeRecordCompletion({
        completions,
        ids: completionIds,
        events,
        clock,
      });
      const r = await record({ userId: ALICE, startDate: START, endDate: END });
      if (!r.isOk) throw new Error("setup failed");
    };

    it("derives current progress from the completion count and publishes GoalProgressed", async () => {
      const goalId = await seedGoal(2);
      await recordCompletion();
      events.published.length = 0;

      const recompute = makeRecomputeGoalProgress({
        goals,
        completions,
        events,
        clock,
      });
      const result = await recompute({ userId: ALICE });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["GoalProgressed"]);

      const stored = await goals.findById(goalId);
      expect(stored?.currentCompletions).toBe(1);
      expect(stored?.isAchieved).toBe(false);
    });

    it("fires GoalAchieved once when the count crosses the target", async () => {
      await seedGoal(2);
      await recordCompletion();
      await recordCompletion();
      events.published.length = 0;

      const recompute = makeRecomputeGoalProgress({
        goals,
        completions,
        events,
        clock,
      });
      await recompute({ userId: ALICE });
      expect(events.names()).toEqual(["GoalProgressed", "GoalAchieved"]);
    });

    it("does not re-fire GoalAchieved on a later recompute past the target", async () => {
      await seedGoal(2);
      await recordCompletion();
      await recordCompletion();
      const recompute = makeRecomputeGoalProgress({
        goals,
        completions,
        events,
        clock,
      });
      await recompute({ userId: ALICE }); // achieved here
      await recordCompletion(); // now 3
      events.published.length = 0;
      await recompute({ userId: ALICE });
      expect(events.names()).toEqual(["GoalProgressed"]);
      expect(events.countOf("GoalAchieved")).toBe(0);
    });

    it("is a no-op (no events) when the count is unchanged", async () => {
      await seedGoal(2);
      await recordCompletion();
      const recompute = makeRecomputeGoalProgress({
        goals,
        completions,
        events,
        clock,
      });
      await recompute({ userId: ALICE });
      events.published.length = 0;
      await recompute({ userId: ALICE }); // still 1
      expect(events.published).toHaveLength(0);
    });
  });
});
