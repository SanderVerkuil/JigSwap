import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The web in production before the ponytail review stack calls identity.getUserByClerkId (10
// dashboard pages) and identity.setLocation (the quick start). Convex deploys before the web, so
// both stay for one release, for their caller only.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        name,
        bio: `${name} bio`,
        location: `${name} town`,
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
    return { alice: await mkUser("alice"), bob: await mkUser("bob") };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });

describe("identity.getUserByClerkId (old web builds)", () => {
  test("resolves the caller's own Clerk id and nobody else's", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const byClerkId = (clerkId: string) =>
      asAlice(t).query(api.identity.getUserByClerkId.getUserByClerkId, {
        clerkId,
      });

    expect(await byClerkId("clerk_alice")).toMatchObject({
      _id: u.alice,
      bio: "alice bio",
    });
    expect(await byClerkId("clerk_bob")).toBeNull();
  });
});

describe("identity.setLocation (old web builds)", () => {
  test("sets and clears the caller's own location under the profile rules", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const setLocation = (location: string) =>
      asAlice(t).mutation(api.identity.setLocation.setLocation, { location });
    const locations = () =>
      t.run(async (ctx) => [
        (await ctx.db.get(u.alice))?.location ?? null,
        (await ctx.db.get(u.bob))?.location ?? null,
      ]);

    await setLocation("  Utrecht  ");
    expect(await locations()).toEqual(["Utrecht", "bob town"]);
    await expect(setLocation("a".repeat(81))).rejects.toThrow();
    await setLocation("   ");
    expect(await locations()).toEqual([null, "bob town"]);
  });
});
