import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { CONTACT_BUDGET } from "./lib/rateLimits";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

describe("contact/submitContactMessage", () => {
  test("persists a valid message as new, trimmed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.contact.submitContactMessage.submitContactMessage, {
      name: "  Mara  ",
      email: " mara@example.com ",
      subject: "swap",
      message: "  I'd love to swap my 1000-piece forest puzzle.  ",
      locale: "nl",
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("contactMessages").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Mara",
      email: "mara@example.com",
      subject: "swap",
      message: "I'd love to swap my 1000-piece forest puzzle.",
      locale: "nl",
      status: "new",
    });
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  test.each([
    ["empty name", { name: "   " }],
    ["bad email", { email: "not-an-email" }],
    ["short message", { message: "too short" }],
    ["oversized message", { message: "x".repeat(5001) }],
  ])("rejects %s", async (_label, override) => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.contact.submitContactMessage.submitContactMessage, {
        name: "Mara",
        email: "mara@example.com",
        subject: "other",
        message: "A perfectly reasonable message.",
        ...override,
      }),
    ).rejects.toThrow(ConvexError);

    const rows = await t.run((ctx) =>
      ctx.db.query("contactMessages").collect(),
    );
    expect(rows).toHaveLength(0);
  });
});

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string; retryAfterMs?: number } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string" ? JSON.parse(data) : (data as never);
};

const VALID = {
  name: "Mara",
  email: "mara@example.com",
  subject: "other",
  message: "A perfectly reasonable message.",
} as const;

const send = (t: TestConvex<typeof schema>, override = {}) =>
  t.mutation(api.contact.submitContactMessage.submitContactMessage, {
    ...VALID,
    ...override,
  });

const contactRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("contactMessages").collect());

// Move every contact budget window `ms` into the past.
const ageBudget = (t: TestConvex<typeof schema>, ms: number) =>
  t.run(async (ctx) => {
    for (const { key } of CONTACT_BUDGET) {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row)
        await ctx.db.patch(row._id, { windowStart: row.windowStart - ms });
    }
  });

// Wide events are JSON lines: info on console.log, error on console.error.
const captureLogs = () => {
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const eventsOf = (spy: typeof info) =>
    spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );
  return { info: () => eventsOf(info), error: () => eventsOf(error) };
};

const [hourly, daily] = CONTACT_BUDGET;

describe("contact/submitContactMessage abuse limits (SEC-22)", () => {
  test("only accepts a supported locale", async () => {
    const t = convexTest(schema, modules);
    // A hand-written client is not bound by the generated argument types.
    const rawLocale = (locale: string) => locale as unknown as "en";

    await expect(
      send(t, { locale: rawLocale("x".repeat(900_000)) }),
    ).rejects.toThrow();
    await expect(send(t, { locale: rawLocale("de") })).rejects.toThrow();
    expect(await contactRows(t)).toHaveLength(0);

    await send(t, { locale: "en" });
    await send(t);
    expect((await contactRows(t)).map((row) => row.locale)).toEqual([
      "en",
      undefined,
    ]);
  });

  test("refuses the message past the hourly budget, writing nothing", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < hourly.cap; i++) await send(t);

    const error = await send(t).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    const data = dataOf(error);
    expect(data.code).toBe("RateLimited");
    expect(data.retryAfterMs).toBeGreaterThan(0);
    expect(data.retryAfterMs).toBeLessThanOrEqual(hourly.windowMs);
    expect(await contactRows(t)).toHaveLength(hourly.cap);
  });

  test("accepts messages again in the next hour", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < hourly.cap; i++) await send(t);
    await ageBudget(t, hourly.windowMs);

    await send(t);
    expect(await contactRows(t)).toHaveLength(hourly.cap + 1);
  });

  test("the daily budget holds once the hour has rolled over", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: daily.key,
        windowStart: Date.now(),
        count: daily.cap,
      }),
    );

    const error = await send(t).catch((e: unknown) => e);
    expect(dataOf(error).code).toBe("RateLimited");
    expect(dataOf(error).retryAfterMs).toBeGreaterThan(hourly.windowMs);
    expect(await contactRows(t)).toHaveLength(0);
  });

  test("invalid input does not use up the budget", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < hourly.cap + 5; i++) {
      await expect(send(t, { message: "too short" })).rejects.toThrow(
        ConvexError,
      );
    }
    expect(
      await t.run((ctx) => ctx.db.query("rateLimits").collect()),
    ).toHaveLength(0);
    await send(t);
    expect(await contactRows(t)).toHaveLength(1);
  });

  test("a loop past the budget logs no error line, only one for the window filling", async () => {
    const t = convexTest(schema, modules);
    const logs = captureLogs();
    for (let i = 0; i < hourly.cap + 30; i++) {
      await send(t).catch(() => undefined);
    }

    expect(logs.error().filter((e) => e.event === "rateLimit.refused")).toEqual(
      [],
    );
    expect(logs.info().filter((e) => e.event === "rateLimit.filled")).toEqual([
      expect.objectContaining({ limit: hourly.key }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
