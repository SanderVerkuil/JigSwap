import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { OwnerId } from "../../domain";
import {
  FixedClock,
  InMemoryPersonalCategoryRepository,
  RecordingEventPublisher,
  SequentialPersonalCategoryIdGenerator,
} from "../testing";
import { makeCreatePersonalCategory } from "./create-personal-category";

const alice = toId<"OwnerId">("alice") as OwnerId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeCreatePersonalCategory", () => {
  let categories: InMemoryPersonalCategoryRepository;
  let events: RecordingEventPublisher;

  const run = () =>
    makeCreatePersonalCategory({
      categories,
      ids: new SequentialPersonalCategoryIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });

  beforeEach(() => {
    categories = new InMemoryPersonalCategoryRepository();
    events = new RecordingEventPublisher();
  });

  it("creates a category and publishes PersonalCategoryCreated", async () => {
    const result = await run()({ ownerId: alice, name: "Animals" });
    expect(result.isOk).toBe(true);
    expect(categories.size()).toBe(1);
    expect(events.names()).toEqual(["PersonalCategoryCreated"]);
  });

  it("rejects a duplicate name for the same owner", async () => {
    await run()({ ownerId: alice, name: "Animals" });
    const second = await run()({ ownerId: alice, name: "Animals" });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("DuplicateCollectionName");
  });
});
