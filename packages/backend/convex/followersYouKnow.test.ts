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

// Wire up the base intersection: viewer follows A, B, C; target is followed by A, B.
// So a viewer with full visibility of `target` sees exactly {A, B}.
const wireIntersection = async (
  t: ReturnType<typeof convexTest>,
  a: string,
  b: string,
  c: string,
  target: string,
) => {
  for (const followeeId of [a, b, c]) {
    await asClerk(t, "clerk_viewer").mutation(
      api.social.followMember.followMember,
      { followeeId: followeeId as never },
    );
  }
  for (const clerk of ["clerk_a", "clerk_b"]) {
    await asClerk(t, clerk).mutation(api.social.followMember.followMember, {
      followeeId: target as never,
    });
  }
};

// Directly stamp a private profile row for a member (bypasses the auth'd mutation so any
// member can be made private from the seed, not just the acting identity).
const makePrivate = (t: ReturnType<typeof convexTest>, memberId: string) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId: memberId as never,
      displayName: "Private Member",
      visibility: "private",
      updatedAt: Date.now(),
    });
  });

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

  test("private target, viewer is NOT a mutual follower -> empty (visibility gate)", async () => {
    const t = convexTest(schema, modules);
    const { a, b, c, target } = await seed(t);
    await wireIntersection(t, a, b, c, target);
    await makePrivate(t, target);
    // Viewer follows target, but target does NOT follow back -> not mutual.

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: target },
    );

    expect(result).toEqual({ total: 0, members: [] });
  });

  test("private target, viewer IS a mutual follower -> intersection returned", async () => {
    const t = convexTest(schema, modules);
    const { viewer, a, b, c, target } = await seed(t);
    await wireIntersection(t, a, b, c, target);
    await makePrivate(t, target);
    // Make viewer<->target mutual: viewer follows target and target follows viewer back.
    await asClerk(t, "clerk_viewer").mutation(
      api.social.followMember.followMember,
      { followeeId: target },
    );
    await asClerk(t, "clerk_target").mutation(
      api.social.followMember.followMember,
      { followeeId: viewer },
    );

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: target },
    );

    expect(result.total).toBe(2);
    expect(result.members.map((m) => m.memberId).sort()).toEqual([a, b].sort());
  });

  test("public target -> intersection returned (no gate)", async () => {
    const t = convexTest(schema, modules);
    const { a, b, c, target } = await seed(t);
    await wireIntersection(t, a, b, c, target);
    // No profile row for target -> defaults to public.

    const result = await asClerk(t, "clerk_viewer").query(
      api.social.followersYouKnow.followersYouKnow,
      { memberId: target },
    );

    expect(result.total).toBe(2);
    expect(result.members.map((m) => m.memberId).sort()).toEqual([a, b].sort());
  });
});
