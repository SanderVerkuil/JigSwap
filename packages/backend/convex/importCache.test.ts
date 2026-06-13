import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const draft = { title: "Cached", sourceUrl: "https://a.com/p" };

describe("catalog.importCache", () => {
  test("put then get round-trips a draft and upserts", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.catalog.importCache.putCachedImport, {
      normalizedUrl: "https://a.com/p",
      draft,
    });
    const first = await t.query(internal.catalog.importCache.getCachedImport, {
      normalizedUrl: "https://a.com/p",
    });
    expect(first?.draft.title).toBe("Cached");

    await t.mutation(internal.catalog.importCache.putCachedImport, {
      normalizedUrl: "https://a.com/p",
      draft: { ...draft, title: "Updated" },
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("puzzleImportCache").collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0].draft.title).toBe("Updated");
  });
});
