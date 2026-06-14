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
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

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
