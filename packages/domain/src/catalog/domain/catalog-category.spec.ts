import { describe, expect, it } from "vitest";
import { DomainEvent, toCatalogCategoryId } from "../../shared-kernel";
import {
  CatalogCategory,
  CreateCatalogCategoryProps,
  LocalizedText,
} from "./catalog-category";
import {
  CatalogCategoryActiveChanged,
  CatalogCategoryReordered,
} from "./events";

const id = toCatalogCategoryId("cc1");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");
const name: LocalizedText = { en: "Landscapes", nl: "Landschappen" };

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const create = (
  overrides: Partial<CreateCatalogCategoryProps> = {},
): CatalogCategory => {
  const r = CatalogCategory.create({
    id,
    name,
    sortOrder: 0,
    now: NOW,
    ...overrides,
  });
  if (!r.isOk) throw new Error(`setup failed: ${r.error.message}`);
  return r.value;
};

describe("CatalogCategory.create", () => {
  it("starts active and records CatalogCategoryCreated", () => {
    const category = create();
    expect(category.isActive).toBe(true);
    expect(category.sortOrder).toBe(0);
    expect(names(category.pullEvents())).toEqual(["CatalogCategoryCreated"]);
  });

  it.each<[string, LocalizedText]>([
    ["blank en", { en: "  ", nl: "Landschappen" }],
    ["blank nl", { en: "Landscapes", nl: "" }],
  ])("rejects an incomplete name (%s)", (_label, badName) => {
    const r = CatalogCategory.create({
      id,
      name: badName,
      sortOrder: 0,
      now: NOW,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyCategoryName");
  });
});

describe("update", () => {
  it("patches color and localized text, recording CatalogCategoryUpdated", () => {
    const category = create();
    category.pullEvents();
    const r = category.update({ color: "#ff0000" }, LATER);
    expect(r.isOk).toBe(true);
    expect(category.toState().color).toBe("#ff0000");
    expect(names(category.pullEvents())).toEqual(["CatalogCategoryUpdated"]);
  });

  // The `??` coalescing keeps a provided value; setting name + description (the latter from an
  // unset baseline) distinguishes `??` from `&&` (which would drop them).
  it("applies a complete replacement name and a new description", () => {
    const category = create(); // no description initially
    const r = category.update(
      {
        name: { en: "Mountains", nl: "Bergen" },
        description: { en: "Peaks", nl: "Toppen" },
      },
      LATER,
    );
    expect(r.isOk).toBe(true);
    expect(category.toState().name).toEqual({ en: "Mountains", nl: "Bergen" });
    expect(category.toState().description).toEqual({
      en: "Peaks",
      nl: "Toppen",
    });
  });

  it("leaves the name unchanged when the patch omits it", () => {
    const category = create();
    category.update({ color: "#123456" }, LATER);
    expect(category.toState().name).toEqual(name);
  });

  it("rejects a replacement name that is incomplete", () => {
    const category = create();
    const r = category.update({ name: { en: "Only EN", nl: " " } }, LATER);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyCategoryName");
  });
});

describe("activate / deactivate (soft, idempotent)", () => {
  it("deactivates softly, emitting CatalogCategoryActiveChanged(false)", () => {
    const category = create();
    category.pullEvents();
    category.deactivate(LATER);
    expect(category.isActive).toBe(false);
    const events = category.pullEvents();
    expect(names(events)).toEqual(["CatalogCategoryActiveChanged"]);
    expect((events[0] as CatalogCategoryActiveChanged).isActive).toBe(false);
  });

  it("is idempotent: deactivating an inactive node emits nothing", () => {
    const category = create();
    category.deactivate(LATER);
    category.pullEvents();
    category.deactivate(LATER);
    expect(category.pullEvents()).toHaveLength(0);
  });

  it("can be reactivated", () => {
    const category = create();
    category.deactivate(NOW);
    category.pullEvents();
    category.activate(LATER);
    expect(category.isActive).toBe(true);
    expect(names(category.pullEvents())).toEqual([
      "CatalogCategoryActiveChanged",
    ]);
  });
});

describe("reorder (stable, idempotent)", () => {
  it("moves to a new position, emitting CatalogCategoryReordered", () => {
    const category = create({ sortOrder: 1 });
    category.pullEvents();
    category.reorder(5, LATER);
    expect(category.sortOrder).toBe(5);
    const events = category.pullEvents();
    expect(names(events)).toEqual(["CatalogCategoryReordered"]);
    expect((events[0] as CatalogCategoryReordered).sortOrder).toBe(5);
  });

  it("is idempotent: reordering to the same position emits nothing", () => {
    const category = create({ sortOrder: 3 });
    category.pullEvents();
    category.reorder(3, LATER);
    expect(category.pullEvents()).toHaveLength(0);
  });
});

describe("rehydrate / toState round-trip", () => {
  it("rehydrates without re-recording events", () => {
    const state = create({ color: "#abc", sortOrder: 7 }).toState();
    const restored = CatalogCategory.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
  });
});
