import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { DOC_FEEDBACK_BUDGET } from "./lib/rateLimits";
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
      }),
    ).rejects.toThrow(ConvexError);
    const rows = await t.run((ctx) => ctx.db.query("docFeedback").collect());
    expect(rows).toHaveLength(0);
  });
});

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string; retryAfterMs?: number } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string" ? JSON.parse(data) : (data as never);
};

const vote = (t: TestConvex<typeof schema>, override = {}) =>
  t.mutation(api.docs.submitDocFeedback.submitDocFeedback, {
    slug: "your-library/collections",
    helpful: true,
    ...override,
  });

const feedbackRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("docFeedback").collect());

// Fill one budget window as if `count` votes had already landed in it.
const fillWindow = (
  t: TestConvex<typeof schema>,
  key: string,
  count: number,
  windowStart = Date.now(),
) => t.run((ctx) => ctx.db.insert("rateLimits", { key, windowStart, count }));

const [hourly, daily] = DOC_FEEDBACK_BUDGET;

describe("docs/submitDocFeedback abuse limits (SEC-22)", () => {
  test("only accepts a supported locale", async () => {
    const t = convexTest(schema, modules);
    // A hand-written client is not bound by the generated argument types.
    const rawLocale = (locale: string) => locale as unknown as "en";

    await expect(
      vote(t, { locale: rawLocale("A".repeat(900_000)) }),
    ).rejects.toThrow();
    await expect(vote(t, { locale: rawLocale("de") })).rejects.toThrow();
    expect(await feedbackRows(t)).toHaveLength(0);

    await vote(t, { locale: "nl" });
    expect((await feedbackRows(t))[0].locale).toBe("nl");
  });

  test("refuses the vote past the hourly budget, writing nothing", async () => {
    const t = convexTest(schema, modules);
    await fillWindow(t, hourly.key, hourly.cap - 1);
    await vote(t);

    const error = await vote(t).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect(dataOf(error).code).toBe("RateLimited");
    expect(dataOf(error).retryAfterMs).toBeLessThanOrEqual(hourly.windowMs);
    expect(await feedbackRows(t)).toHaveLength(1);
  });

  test("accepts votes again in the next hour, within the day", async () => {
    const t = convexTest(schema, modules);
    await fillWindow(t, hourly.key, hourly.cap, Date.now() - hourly.windowMs);
    await fillWindow(t, daily.key, daily.cap - 1);
    // A new hour, and the last vote the day allows.
    await vote(t);
    expect(await feedbackRows(t)).toHaveLength(1);

    const error = await vote(t).catch((e: unknown) => e);
    expect(dataOf(error).code).toBe("RateLimited");
    expect(await feedbackRows(t)).toHaveLength(1);
  });

  test("invalid input does not use up the budget", async () => {
    const t = convexTest(schema, modules);
    await expect(vote(t, { slug: "   " })).rejects.toThrow(ConvexError);
    expect(
      await t.run((ctx) => ctx.db.query("rateLimits").collect()),
    ).toHaveLength(0);
  });
});
