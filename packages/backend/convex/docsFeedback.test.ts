import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

describe("docs/submitDocFeedback", () => {
  test("persists a helpful vote, trimmed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.docs.submitDocFeedback.submitDocFeedback, {
      slug: "your-library/collections",
      helpful: true,
      comment: "  super clear  ",
      locale: "en",
    });
    const rows = await t.run((ctx) => ctx.db.query("docFeedback").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "your-library/collections",
      helpful: true,
      comment: "super clear",
      locale: "en",
    });
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  test("accepts a vote without a comment", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.docs.submitDocFeedback.submitDocFeedback, {
      slug: "help/faq-and-troubleshooting",
      helpful: false,
    });
    const rows = await t.run((ctx) => ctx.db.query("docFeedback").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].comment).toBeUndefined();
  });

  test.each([
    ["empty slug", { slug: "   " }],
    ["oversized comment", { comment: "x".repeat(2001) }],
  ])("rejects %s", async (_label, override) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.docs.submitDocFeedback.submitDocFeedback, {
        slug: "your-library/collections",
        helpful: true,
        ...override,
      } as any),
    ).rejects.toThrow(ConvexError);
    const rows = await t.run((ctx) => ctx.db.query("docFeedback").collect());
    expect(rows).toHaveLength(0);
  });
});
