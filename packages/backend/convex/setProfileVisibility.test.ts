import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com", "Alice");
    const bob = await mkUser("clerk_bob", "bob@example.com", "Bob");
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("setProfileVisibility", () => {
  test("a freshly created profile defaults to public", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });
    const profile = await asAlice(t).query(
      api.social.getProfile.getProfile,
      {},
    );
    expect(profile?.visibility).toBe("public");
  });

  test("setting visibility to private persists and getProfile reflects it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });

    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );
    let profile = await asAlice(t).query(api.social.getProfile.getProfile, {});
    expect(profile?.visibility).toBe("private");

    // Toggling back to public works too.
    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "public" },
    );
    profile = await asAlice(t).query(api.social.getProfile.getProfile, {});
    expect(profile?.visibility).toBe("public");
  });

  test("toggling visibility before any profile edit mints a profile (create-on-first-use)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    // No editProfile call first: the member has no profile yet.
    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    const profile = await asAlice(t).query(
      api.social.getProfile.getProfile,
      {},
    );
    expect(profile?.visibility).toBe("private");
    // Display name defaulted to the account name.
    expect(profile?.displayName).toBe("Alice");
    expect(profile?.aggregateId).toBeDefined();
  });

  test("setProfileVisibility records a ProfileVisibilityChanged domain event", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );
    const events = await t.run((ctx) => ctx.db.query("domainEvents").collect());
    expect(events.map((e) => e.name)).toContain("ProfileVisibilityChanged");
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.mutation(api.social.setProfileVisibility.setProfileVisibility, {
        visibility: "private",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("getProfile visibility", () => {
  test("getProfile requires authentication even when a memberId is supplied", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });

    // Passing memberId must NOT bypass requireMember: an unauthenticated caller is rejected.
    await expect(
      t.query(api.social.getProfile.getProfile, { memberId: alice }),
    ).rejects.toThrow(ConvexError);
  });

  test("a public profile is visible to a non-connected viewer", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });

    const seenByBob = await asBob(t).query(api.social.getProfile.getProfile, {
      memberId: alice,
    });
    expect(seenByBob?.displayName).toBe("Alice A.");
    expect(seenByBob?.visibility).toBe("public");
  });

  test("a private profile is hidden from a non-connected viewer but visible to its owner", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });
    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    // Non-connected Bob gets null for Alice's private profile.
    const seenByBob = await asBob(t).query(api.social.getProfile.getProfile, {
      memberId: alice,
    });
    expect(seenByBob).toBeNull();

    // The owner still sees their own private profile.
    const seenBySelf = await asAlice(t).query(
      api.social.getProfile.getProfile,
      { memberId: alice },
    );
    expect(seenBySelf?.visibility).toBe("private");
  });

  test("mutual followers can see each other's private profiles", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });
    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    // Establish the mutual follow edge (both directions).
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const seenByBob = await asBob(t).query(api.social.getProfile.getProfile, {
      memberId: alice,
    });
    expect(seenByBob?.displayName).toBe("Alice A.");
    expect(seenByBob?.visibility).toBe("private");
  });
});
