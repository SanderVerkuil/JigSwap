import type { ProfileView } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = (t: TestConvex<typeof schema>) =>
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

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

describe("setProfileVisibility", () => {
  test("a freshly created profile has no visibility chosen yet", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });
    const profile = await asAlice(t).query(
      api.social.getProfile.getProfile,
      {},
    );
    expect(profile).not.toBeNull();
    expect(profile?.visibility).toBeUndefined();
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
    // No display name is seeded: readers fall back to the live account name.
    expect(profile?.displayName).toBeUndefined();
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

// Another member's profile is read through getPublicProfile (publicProfile.test.ts covers its
// public, private, mutual and self cases); getProfile reads the caller's own row only.
describe("getProfile: the caller's own profile only", () => {
  // A stale or hostile client still calling with the old `memberId` argument.
  const profileOf = makeFunctionReference<
    "query",
    { memberId: Id<"users"> },
    ProfileView | null
  >("social/getProfile:getProfile");

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(t.query(api.social.getProfile.getProfile, {})).rejects.toThrow(
      ConvexError,
    );
  });

  test("another member's profile can't be asked for: a memberId is refused by the validator", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.social.editProfile.editProfile, {
      displayName: "Alice A.",
    });

    await expect(
      asBob(t).query(profileOf, { memberId: alice }),
    ).rejects.toThrow(/Validator/);
    // Not even for the caller's own id.
    await expect(
      asAlice(t).query(profileOf, { memberId: alice }),
    ).rejects.toThrow(/Validator/);
  });
});
