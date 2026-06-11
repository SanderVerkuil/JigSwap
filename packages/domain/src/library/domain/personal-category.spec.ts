import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toOwnerId,
  toPersonalCategoryId,
} from "../../shared-kernel";
import { PersonalCategoryCreated } from "./events";

import { PersonalCategory } from "./personal-category";

const id = toPersonalCategoryId("pc1");
const owner = toOwnerId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const create = (
  over: Partial<Parameters<typeof PersonalCategory.create>[0]> = {},
) => {
  const r = PersonalCategory.create({
    id,
    ownerId: owner,
    name: "Animals",
    now: NOW,
    ...over,
  });
  if (!r.isOk) throw new Error("setup");
  return r.value;
};

describe("PersonalCategory.create", () => {
  it("exposes the supplied identity through its getters", () => {
    const category = create();
    expect(category.id).toBe(id);
    expect(category.ownerId).toBe(owner);
    expect(category.name).toBe("Animals");
  });

  it("records PersonalCategoryCreated carrying owner, name and timestamp", () => {
    const category = create();
    const events = category.pullEvents();
    expect(names(events)).toEqual(["PersonalCategoryCreated"]);
    const created = events[0] as PersonalCategoryCreated;
    expect(created.ownerId).toBe(owner);
    expect(created.occurredAt).toBe(NOW);
  });

  it("defaults isDefault to false but honours an explicit true", () => {
    expect(create().toState().isDefault).toBe(false);
    expect(create({ isDefault: true }).toState().isDefault).toBe(true);
    expect(create({ isDefault: false }).toState().isDefault).toBe(false);
  });
});

describe("PersonalCategory rehydrate / pullEvents", () => {
  it("rehydrates from state without re-recording events", () => {
    const state = create().toState();
    const restored = PersonalCategory.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
  });

  it("drains the event buffer so events are not emitted twice", () => {
    const category = create();
    expect(category.pullEvents()).toHaveLength(1);
    expect(category.pullEvents()).toHaveLength(0);
  });
});
