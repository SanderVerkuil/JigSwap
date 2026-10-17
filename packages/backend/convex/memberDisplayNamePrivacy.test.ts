import { resolveMemberDisplayName } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { projectMemberIdentity } from "./social/privacy";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HIDDEN_EMAIL = "nameless.secret@example.com";

// A viewer (Alice) and a member with NO name and NO username (the "null null" population after the
// sync fix) whose email Alice is not allowed to see.
const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const nameless = await ctx.db.insert("users", {
      clerkId: "clerk_nameless",
      email: HIDDEN_EMAIL,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, nameless };
  });

describe("member display-name fallback never leaks a hidden email", () => {
  test("projectMemberIdentity reveals a nameless member without their email", async () => {
    const t = convexTest(schema, modules);
    const { alice, nameless } = await seed(t);

    const projected = await t.run((ctx) =>
      projectMemberIdentity(ctx, alice, nameless, "salt"),
    );

    expect(projected.anonymous).toBe(false);
    expect(JSON.stringify(projected)).not.toContain(HIDDEN_EMAIL);
    if (projected.anonymous) return;
    // The shared resolver therefore cannot pick the email: the web shows the generic label.
    expect(resolveMemberDisplayName(projected.member)).toBeUndefined();
  });

  test("the followers list resolves a nameless follower to no name, not their email", async () => {
    const t = convexTest(schema, modules);
    const { alice, nameless } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("follows", {
        followerId: nameless,
        followeeId: alice,
        createdAt: Date.now(),
      }),
    );

    const followers = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.social.listFollowers.listFollowers, {});

    expect(followers).toHaveLength(1);
    expect(followers[0].displayName).toBeUndefined();
    expect(JSON.stringify(followers)).not.toContain(HIDDEN_EMAIL);
  });
});
