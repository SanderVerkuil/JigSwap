import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// catalog/backfillCategories: stamps aggregateIds on legacy adminCategories rows so the
// domain path (repository keyed on by_aggregate_id) can load them and the admin UI's
// edit/deactivate actions enable.
describe("catalog/backfillCategories", () => {
  const seed = async (
    t: ReturnType<typeof convexTest>,
    opts: { name: string; aggregateId?: string },
  ) =>
    t.run(async (ctx) =>
      ctx.db.insert("adminCategories", {
        ...(opts.aggregateId ? { aggregateId: opts.aggregateId } : {}),
        name: { en: opts.name, nl: opts.name },
        description: { en: opts.name, nl: opts.name },
        color: "#888888",
        isActive: true,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

  it("stamps legacy rows, leaves stamped rows untouched, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { name: "Legacy" });
    await seed(t, { name: "Modern", aggregateId: "existing-id" });

    const first = await t.mutation(internal.catalog.backfillCategories.run, {});
    expect(first).toEqual({ total: 2, patched: 1 });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("adminCategories").collect(),
    );
    const legacy = rows.find((r) => r.name.en === "Legacy");
    const modern = rows.find((r) => r.name.en === "Modern");
    expect(legacy?.aggregateId).toBeTruthy();
    expect(modern?.aggregateId).toBe("existing-id");

    const second = await t.mutation(
      internal.catalog.backfillCategories.run,
      {},
    );
    expect(second).toEqual({ total: 2, patched: 0 });
  });
});
