import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Public writes a free account could loop on: each bucket allows what a member would do by hand and
// refuses a script. A refused call writes nothing, and a refusal for another reason costs nothing.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
let t: T;
let me: Id<"users">;
const asMe = () => t.withIdentity({ subject: "clerk_me" });

beforeEach(async () => {
  t = convexTest(schema, modules);
  me = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_me",
      email: "me@example.com",
      name: "Me",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
});

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const expectRateLimited = async (call: Promise<unknown>) => {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data;
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  expect(parsed).toMatchObject({ code: "RateLimited" });
};

describe("createCollection", () => {
  const create = (name: string) =>
    asMe().mutation(api.library.createCollection.createCollection, { name });

  test("allows a day's worth and refuses the next one", async () => {
    for (let i = 0; i < RATE_LIMITS.collectionCreate.max; i++) {
      await create(`Collection ${i}`);
    }
    await expectRateLimited(create("One more"));
    const rows = await t.run((ctx) => ctx.db.query("collections").collect());
    expect(rows).toHaveLength(RATE_LIMITS.collectionCreate.max);
  });

  test("a refused name isn't charged", async () => {
    await create("Taken");
    await expect(create("Taken")).rejects.toThrow(/DuplicateCollectionName/);
    const row = await t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `collectionCreate:${me}`))
        .unique(),
    );
    expect(row?.count).toBe(1);
  });
});

describe("createPersonalCategory", () => {
  test("allows a day's worth and refuses the next one", async () => {
    const create = (name: string) =>
      asMe().mutation(
        api.library.createPersonalCategory.createPersonalCategory,
        { name },
      );
    for (let i = 0; i < RATE_LIMITS.categoryCreate.max; i++) {
      await create(`Category ${i}`);
    }
    await expectRateLimited(create("One more"));
    const rows = await t.run((ctx) => ctx.db.query("categories").collect());
    expect(rows).toHaveLength(RATE_LIMITS.categoryCreate.max);
  });
});
