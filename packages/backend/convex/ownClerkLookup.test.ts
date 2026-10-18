import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// #282: getUserByClerkId resolves only the caller's own Clerk id (every web caller looks up the
// signed-in member). It applies no profile-visibility rules, so it must never hand out another
// member's MemberView (bio, location).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        name,
        username: name,
        bio: `${name} bio`,
        location: `${name} town`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    await ctx.db.insert("profiles", {
      aggregateId: "profile-bob",
      memberId: bob,
      displayName: "Bobby",
      bio: "profile bio",
      visibility: "private",
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });

describe("identity.getUserByClerkId: own lookup only", () => {
  test("resolves the caller's own Clerk id", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    expect(
      await asAlice(t).query(api.identity.getUserByClerkId.getUserByClerkId, {
        clerkId: "clerk_alice",
      }),
    ).toMatchObject({ _id: u.alice, bio: "alice bio" });
  });

  test("returns null for another member's Clerk id, public profile or not", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      const carol = await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        name: "carol",
        bio: "carol bio",
        location: "carol town",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("profiles", {
        memberId: carol,
        visibility: "public",
        updatedAt: Date.now(),
      });
    });
    for (const clerkId of ["clerk_bob", "clerk_carol"]) {
      expect(
        await asAlice(t).query(api.identity.getUserByClerkId.getUserByClerkId, {
          clerkId,
        }),
      ).toBeNull();
    }
  });
});
