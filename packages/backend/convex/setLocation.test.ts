import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// identity.setLocation (quick start step 5, spec 2026-10-17 §2.4, §4): the caller's own
// users.location only; trimmed, empty clears it, at most 80 characters (`invalid_location`).
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const insertUser = (t: T, name: string, location?: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      ...(location !== undefined ? { location } : {}),
    }),
  );

const setLocation = (t: T, who: string, location: string) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .mutation(api.identity.setLocation.setLocation, { location });

const locationOf = (t: T, id: Awaited<ReturnType<typeof insertUser>>) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.location);

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const errorDataOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<Value>).data;
    return typeof data === "string" && data.startsWith("{")
      ? JSON.parse(data)
      : data;
  }
  throw new Error("expected the call to reject");
};

describe("identity.setLocation", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    expect(
      await errorDataOf(
        t.mutation(api.identity.setLocation.setLocation, {
          location: "Utrecht",
        }),
      ),
    ).toBe("Unauthenticated");
  });

  test("sets the caller's own location, trimmed, and nobody else's", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const bob = await insertUser(t, "bob", "Leiden");
    expect(await setLocation(t, "ann", "  Utrecht  ")).toBeNull();
    expect(await locationOf(t, ann)).toBe("Utrecht");
    expect(await locationOf(t, bob)).toBe("Leiden");
    const updatedAt = await t.run(
      async (ctx) => (await ctx.db.get(ann))?.updatedAt,
    );
    expect(updatedAt).toBeGreaterThan(1);
  });

  test("an empty or blank value clears it", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", "Utrecht");
    await setLocation(t, "ann", "   ");
    // t.run serializes its result, so check for the field inside the transaction.
    expect(
      await t.run(async (ctx) => "location" in ((await ctx.db.get(ann)) ?? {})),
    ).toBe(false);
  });

  test("accepts 80 characters and refuses 81 (after trimming)", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", "Utrecht");
    await setLocation(t, "ann", ` ${"a".repeat(80)} `);
    expect(await locationOf(t, ann)).toBe("a".repeat(80));
    expect(await errorDataOf(setLocation(t, "ann", "a".repeat(81)))).toEqual({
      code: "invalid_location",
    });
    expect(await locationOf(t, ann)).toBe("a".repeat(80));
  });

  test("marks quick start step 5 done", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    const profileStep = async () =>
      (
        await t
          .withIdentity({ subject: "clerk_ann" })
          .query(api.onboarding.getQuickStart.getQuickStart, {})
      ).steps.find((s) => s.id === "profile")?.status;
    expect(await profileStep()).toBe("todo");
    await setLocation(t, "ann", "Utrecht");
    expect(await profileStep()).toBe("done");
  });
});
