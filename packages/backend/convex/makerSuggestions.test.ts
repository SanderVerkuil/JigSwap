import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed one puzzles row; only maker fields + status vary per test.
const seedPuzzle = (
  t: ReturnType<typeof convexTest>,
  fields: {
    title: string;
    brand?: string;
    publisher?: string;
    series?: string;
    status?: "pending" | "approved" | "rejected" | "disabled";
  },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const submittedBy = await ctx.db.insert("users", {
      clerkId: `clerk_${fields.title}`,
      email: `${fields.title}@example.com`,
      name: fields.title,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("puzzles", {
      title: fields.title,
      brand: fields.brand,
      publisher: fields.publisher,
      series: fields.series,
      pieceCount: 1000,
      status: fields.status ?? "approved",
      submittedBy,
      createdAt: now,
      updatedAt: now,
    });
  });

describe("catalog.getAllPublishers", () => {
  test("merges the allowlist with distinct approved values, deduped case-insensitively", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, { title: "A", publisher: "jumbo" }); // dupes allowlist "Jumbo"
    await seedPuzzle(t, { title: "B", publisher: "Goliath" }); // not in allowlist
    await seedPuzzle(t, { title: "C", publisher: "Sneaky", status: "pending" }); // excluded

    const publishers = await t.query(
      api.catalog.getAllPublishers.getAllPublishers,
      {},
    );

    expect(publishers).toContain("Jumbo"); // canonical casing wins over "jumbo"
    expect(publishers).not.toContain("jumbo");
    expect(publishers).toContain("Ravensburger"); // allowlist present without data
    expect(publishers).toContain("Goliath"); // data value outside the allowlist
    expect(publishers).not.toContain("Sneaky"); // pending never leaks
    expect([...publishers]).toEqual(
      [...publishers].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("catalog.getAllSeries", () => {
  test("scopes to the given brand and falls back to all series", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, { title: "W1", brand: "Wasgij", series: "Mystery" });
    await seedPuzzle(t, { title: "W2", brand: "Wasgij", series: "Original" });
    await seedPuzzle(t, {
      title: "J1",
      brand: "Jan van Haasteren",
      series: "Junior",
    });
    await seedPuzzle(t, {
      title: "P1",
      brand: "Wasgij",
      series: "Hidden",
      status: "pending",
    });

    const scoped = await t.query(api.catalog.getAllSeries.getAllSeries, {
      brand: "Wasgij",
    });
    expect(scoped.sort()).toEqual(["Mystery", "Original"]); // no Junior, no pending Hidden

    const all = await t.query(api.catalog.getAllSeries.getAllSeries, {});
    expect(all.sort()).toEqual(["Junior", "Mystery", "Original"]);

    // Unknown maker: scoped list is empty -> fall back to all series.
    const fallback = await t.query(api.catalog.getAllSeries.getAllSeries, {
      brand: "Ravensburger",
    });
    expect(fallback.sort()).toEqual(["Junior", "Mystery", "Original"]);
  });

  test("scopes by publisher when no brand is given", async () => {
    const t = convexTest(schema, modules);
    await seedPuzzle(t, {
      title: "R1",
      publisher: "Ravensburger",
      series: "Krypt",
    });
    await seedPuzzle(t, { title: "J1", publisher: "Jumbo", series: "Junior" });

    const scoped = await t.query(api.catalog.getAllSeries.getAllSeries, {
      publisher: "Ravensburger",
    });
    expect(scoped).toEqual(["Krypt"]);
  });
});
