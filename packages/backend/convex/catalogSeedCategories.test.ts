import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import {
  CATEGORY_FIXTURE,
  RETIRED_CATEGORIES,
} from "./catalog/categoryFixture";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The 10 rows dev and prod hold today: all active, sortOrder 0, colour #3B82F6.
const CURRENT_ROWS: [string, string][] = [
  ["0160a2fd-6d91-4fde-a012-b2526402c830", "Traveling"],
  ["9718ab40-2753-4825-ad6a-2b16be863307", "Nature"],
  ["19261ebd-353a-478c-b4a4-04e11a94ecb7", "Landscape"],
  ["497af941-c5da-4c32-9735-661a55a075bb", "Flowers"],
  ["78612f07-55ca-4997-bc86-3085547d9f87", "Fantasy"],
  ["4c9d591a-c542-445f-bda4-d2da4a3babdd", "Easy puzzles"],
  ["9ea17db4-2468-4be1-9de0-da16909913c1", "Dogs"],
  ["bafb20f9-618d-4303-a236-0af303a5a32a", "Colourfull"],
  ["20f75ac7-d8e8-4257-b108-f67d3f1dff0a", "Cats"],
  ["2a85ac94-8641-4548-ad7c-57bb3a4131c8", "Animals"],
];

const seedCurrentState = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    for (const [aggregateId, name] of CURRENT_ROWS) {
      await ctx.db.insert("adminCategories", {
        aggregateId,
        name: { en: name, nl: name },
        color: "#3B82F6",
        isActive: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });

const allRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("adminCategories").collect());

const seed = (t: TestConvex<typeof schema>, dryRun?: boolean) =>
  t.mutation(
    internal.catalog.seedCategories.run,
    dryRun === undefined ? {} : { dryRun },
  );

// The rows that should be active, as [en, nl, sortOrder], in sortOrder.
const expectedActive = CATEGORY_FIXTURE.map(
  (target, index) => [target.name.en, target.name.nl, index + 1] as const,
);
const activeRows = async (t: TestConvex<typeof schema>) =>
  (await allRows(t))
    .filter((row) => row.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => [row.name.en, row.name.nl, row.sortOrder] as const);

describe("catalog/seedCategories", () => {
  it("fixture colours are distinct hex values", () => {
    const colors = CATEGORY_FIXTURE.map((target) => target.color);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("creates the whole taxonomy on a fresh deployment, each row with an aggregateId", async () => {
    const t = convexTest(schema, modules);

    const result = await seed(t, false);

    expect(result.created).toHaveLength(CATEGORY_FIXTURE.length);
    expect(result.updated).toEqual([]);
    expect(result.deactivated).toEqual([]);
    expect(await activeRows(t)).toEqual(expectedActive);
    const rows = await allRows(t);
    expect(rows).toHaveLength(CATEGORY_FIXTURE.length);
    for (const row of rows) {
      expect(row.aggregateId).toBeTruthy();
      expect(row.description?.en).toBeTruthy();
      expect(row.description?.nl).toBeTruthy();
    }
    expect(new Set(rows.map((row) => row.aggregateId)).size).toBe(rows.length);
  });

  it("dry run is the default and plans the current dev/prod state without writing", async () => {
    const t = convexTest(schema, modules);
    await seedCurrentState(t);
    const before = await allRows(t);

    const plan = await seed(t);

    expect(plan.dryRun).toBe(true);
    expect(await allRows(t)).toEqual(before);
    expect(plan.created.map((entry) => entry.name)).toEqual([
      "Maps",
      "Fine Art",
      "Sci-fi & Space",
      "Food & Drink",
      "Nostalgia & History",
      "Cottages & Country Life",
      "Seasons & Holidays",
      "Transport",
      "Film, TV & Characters",
      "Cartoon & Humour",
      "Music, Sports & Hobbies",
    ]);
    expect(plan.created.every((entry) => !entry.aggregateId)).toBe(true);
    expect(
      plan.updated.map((entry) => [entry.name, entry.previousName]),
    ).toEqual([
      ["Animals", undefined],
      ["Nature & Landscapes", "Landscape"],
      ["Flowers & Gardens", "Flowers"],
      ["Cities & Landmarks", "Traveling"],
      ["Fantasy & Fairy Tales", "Fantasy"],
      ["Patterns & Colour", "Colourfull"],
    ]);
    expect(plan.updated[0].changes).toEqual([
      "name",
      "description",
      "color",
      "sortOrder",
    ]);
    expect(plan.deactivated.map((entry) => entry.name)).toEqual([
      "Nature",
      "Cats",
      "Dogs",
      "Easy puzzles",
    ]);
    expect(plan.unchanged).toEqual([]);
  });

  it("renames the reused rows, creates the rest, and deactivates (never deletes) the retired rows", async () => {
    const t = convexTest(schema, modules);
    await seedCurrentState(t);

    await seed(t, false);

    const rows = await allRows(t);
    expect(rows).toHaveLength(CURRENT_ROWS.length + 11);
    expect(await activeRows(t)).toEqual(expectedActive);

    const byId = new Map(rows.map((row) => [row.aggregateId, row]));
    expect(byId.get("0160a2fd-6d91-4fde-a012-b2526402c830")?.name).toEqual({
      en: "Cities & Landmarks",
      nl: "Steden & bezienswaardigheden",
    });
    expect(byId.get("bafb20f9-618d-4303-a236-0af303a5a32a")?.color).toBe(
      "#14B8A6",
    );
    for (const retired of RETIRED_CATEGORIES) {
      const row = byId.get(retired.aggregateId);
      expect(row?.isActive).toBe(false);
      expect(row?.name.en).toBe(retired.en);
    }
  });

  it("is idempotent: a second run changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedCurrentState(t);
    await seed(t, false);
    const after = await allRows(t);

    const second = await seed(t, false);

    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.deactivated).toEqual([]);
    expect(second.unchanged).toHaveLength(
      CATEGORY_FIXTURE.length + RETIRED_CATEGORIES.length,
    );
    expect(await allRows(t)).toEqual(after);
  });

  it("matches a row by case-insensitive English name when its aggregateId is unknown", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("adminCategories", {
        aggregateId: "other-deployment-id",
        name: { en: "  fine art ", nl: "Kunst" },
        isActive: false,
        sortOrder: 9,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await seed(t, false);

    expect(result.created).toHaveLength(CATEGORY_FIXTURE.length - 1);
    expect(result.updated).toEqual([
      {
        aggregateId: "other-deployment-id",
        name: "Fine Art",
        previousName: "  fine art ",
        changes: ["name", "description", "color", "sortOrder", "activated"],
      },
    ]);
    expect(await activeRows(t)).toEqual(expectedActive);
  });

  it("refuses to run while legacy rows lack an aggregateId", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("adminCategories", {
        name: { en: "Legacy", nl: "Legacy" },
        isActive: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(seed(t)).rejects.toThrow(/backfillCategories/);
  });
});
