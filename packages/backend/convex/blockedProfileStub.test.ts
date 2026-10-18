import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// #282: getProfile's stub for a member the viewer blocked carries identity and visibility only,
// never the profile row's ids or timestamps (a block must not grant more than the private-profile
// rule allows).

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

describe("social.getProfile: blocked-by-me stub", () => {
  test("carries identity and visibility only", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: u.alice,
        blockedId: u.bob,
        createdAt: Date.now(),
      }),
    );
    const stub = await asAlice(t).query(api.social.getProfile.getProfile, {
      memberId: u.bob,
    });
    expect(stub).toEqual({
      memberId: u.bob,
      displayName: "Bobby",
      visibility: "private",
      blockedByMe: true,
    });
  });
});
