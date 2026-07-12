import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const viewer = await mkUser("clerk_viewer");
    const a = await mkUser("clerk_a");
    const b = await mkUser("clerk_b");
    const c = await mkUser("clerk_c");
    const target = await mkUser("clerk_target");
    const x = await mkUser("clerk_x");
    return { viewer, a, b, c, target, x };
  });

const asClerk = (t: ReturnType<typeof convexTest>, subject: string) =>
  t.withIdentity({ subject });

describe("followersYouKnow", () => {
  test("returns the viewer's following intersected with the target's followers, excluding non-followed and the viewer themself", async () => {
    const t = convexTest(schema, modules);
    const { viewer, a, b, c, target, x } = await seed(t);

    // Viewer follows A, B, C.
    for (const followeeId of [a, b, c]) {
      await asClerk(t, "clerk_viewer").mutation(
        api.social.followMember.followMember,
        { followeeId },
      );
    }
    // Target is followed by A, B, and X (X is NOT followed by the viewer).
    for (const clerk of ["clerk_a", "clerk_b", "clerk_x"]) {
      await asClerk(t, clerk).mutation(api.social.followMember.followMember, {
        followeeId: target,
      });
    }

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: target },
    );

    expect(result.total).toBe(2);
    const ids = result.members.map((m) => m.memberId).sort();
    expect(ids).toEqual([a, b].sort());
    expect(ids).not.toContain(x as string);
    expect(ids).not.toContain(viewer as string);
  });

  test("a member's own profile always returns empty, even if they'd otherwise match", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await seed(t);

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: viewer },
    );

    expect(result).toEqual({ total: 0, members: [] });
  });

  test("no known followers -> empty", async () => {
    const t = convexTest(schema, modules);
    const { target, x } = await seed(t);

    // Target is only followed by X, whom the viewer does not follow.
    await asClerk(t, "clerk_x").mutation(api.social.followMember.followMember, {
      followeeId: target,
    });

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: target },
    );

    expect(result).toEqual({ total: 0, members: [] });
  });
});
