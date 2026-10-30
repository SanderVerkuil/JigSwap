import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { toCommunityAvatarView } from "./insights/getCommunityAvatars";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Insert a set of active users and optionally a few inactive ones. Each gets a profile row that
// explicitly chose "public" unless `profile` says otherwise (null = no profile row at all; a row
// without `visibility` = opened without a choice).
const seedUsers = async (
  t: TestConvex<typeof schema>,
  users: Array<{
    name: string;
    avatar?: string;
    shareAvatarPublicly?: boolean;
    isActive?: boolean;
    profile?: {
      visibility?: "public" | "private";
      displayName?: string;
    } | null;
  }>,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: string[] = [];
    for (const u of users) {
      const id = await ctx.db.insert("users", {
        clerkId: `clerk_${Math.random()}`,
        email: `user_${Math.random()}@example.com`,
        name: u.name,
        avatar: u.avatar,
        shareAvatarPublicly: u.shareAvatarPublicly,
        isActive: u.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      });
      const profile =
        u.profile === undefined ? { visibility: "public" as const } : u.profile;
      if (profile !== null) {
        await ctx.db.insert("profiles", {
          memberId: id,
          ...profile,
          updatedAt: now,
        });
      }
      ids.push(id);
    }
    return ids;
  });

// ---------------------------------------------------------------------------
// Unit tests for the pure toCommunityAvatarView mapper
// ---------------------------------------------------------------------------

describe("toCommunityAvatarView — initials derivation", () => {
  const makeDoc = (
    overrides: Partial<{
      name: string;
      avatar: string;
      shareAvatarPublicly: boolean;
    }>,
  ) =>
    ({
      _id: "users:fake" as never,
      _creationTime: 0,
      clerkId: "clerk_x",
      email: "x@example.com",
      isActive: true,
      createdAt: 0,
      updatedAt: 0,
      name: overrides.name ?? "",
      avatar: overrides.avatar,
      shareAvatarPublicly: overrides.shareAvatarPublicly,
    }) as Parameters<typeof toCommunityAvatarView>[0];

  test('"Sander Verkuil" → "SV"', () => {
    expect(
      toCommunityAvatarView(makeDoc({ name: "Sander Verkuil" })).initials,
    ).toBe("SV");
  });

  test('"Madonna" (single word) → "MA"', () => {
    expect(toCommunityAvatarView(makeDoc({ name: "Madonna" })).initials).toBe(
      "MA",
    );
  });

  test("empty name → fallback PZ", () => {
    expect(toCommunityAvatarView(makeDoc({ name: "" })).initials).toBe("PZ");
  });

  test("whitespace-only name → fallback PZ", () => {
    expect(toCommunityAvatarView(makeDoc({ name: "   " })).initials).toBe("PZ");
  });

  test('legacy "null null" name → fallback PZ, not "NN"', () => {
    expect(toCommunityAvatarView(makeDoc({ name: "null null" })).initials).toBe(
      "PZ",
    );
  });

  test("absent name → fallback PZ", () => {
    expect(toCommunityAvatarView(makeDoc({ name: undefined })).initials).toBe(
      "PZ",
    );
  });

  test("three-word name uses first + last initial", () => {
    expect(
      toCommunityAvatarView(makeDoc({ name: "Alice Bob Carol" })).initials,
    ).toBe("AC");
  });

  test("initials are uppercased", () => {
    expect(
      toCommunityAvatarView(makeDoc({ name: "alice verkuil" })).initials,
    ).toBe("AV");
  });
});

describe("toCommunityAvatarView — consent-gated image", () => {
  const makeDoc = (
    overrides: Partial<{
      name: string;
      avatar: string;
      shareAvatarPublicly: boolean;
    }>,
  ) =>
    ({
      _id: "users:fake" as never,
      _creationTime: 0,
      clerkId: "clerk_x",
      email: "x@example.com",
      isActive: true,
      createdAt: 0,
      updatedAt: 0,
      name: overrides.name ?? "Test User",
      avatar: overrides.avatar,
      shareAvatarPublicly: overrides.shareAvatarPublicly,
    }) as Parameters<typeof toCommunityAvatarView>[0];

  test("no consent (field absent) → image is null even when avatar is set", () => {
    const view = toCommunityAvatarView(
      makeDoc({ avatar: "https://example.com/photo.jpg" }),
    );
    expect(view.image).toBeNull();
  });

  test("shareAvatarPublicly: false → image is null", () => {
    const view = toCommunityAvatarView(
      makeDoc({
        avatar: "https://example.com/photo.jpg",
        shareAvatarPublicly: false,
      }),
    );
    expect(view.image).toBeNull();
  });

  test("shareAvatarPublicly: true + avatar set → image equals avatar URL", () => {
    const url = "https://example.com/photo.jpg";
    const view = toCommunityAvatarView(
      makeDoc({ avatar: url, shareAvatarPublicly: true }),
    );
    expect(view.image).toBe(url);
  });

  test("shareAvatarPublicly: true but no avatar → image is null", () => {
    const view = toCommunityAvatarView(makeDoc({ shareAvatarPublicly: true }));
    expect(view.image).toBeNull();
  });

  test("result objects contain ONLY initials and image keys (privacy regression guard)", () => {
    const view = toCommunityAvatarView(
      makeDoc({
        name: "Sander Verkuil",
        avatar: "https://example.com/a.jpg",
        shareAvatarPublicly: true,
      }),
    );
    expect(Object.keys(view).sort()).toEqual(["image", "initials"]);
  });
});

// ---------------------------------------------------------------------------
// Integration tests against the Convex in-memory runtime
// ---------------------------------------------------------------------------

describe("insights.getCommunityAvatars — query behaviour", () => {
  test("same seed returns the same order (determinism)", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Alice A" },
      { name: "Bob B" },
      { name: "Carol C" },
      { name: "Dave D" },
      { name: "Eve E" },
    ]);

    const runA = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 3, seed: 42 },
    );
    const runB = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 3, seed: 42 },
    );

    expect(runA.map((m) => m.initials)).toEqual(runB.map((m) => m.initials));
  });

  test("different seeds return different orders (sanity)", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Alice A" },
      { name: "Bob B" },
      { name: "Carol C" },
      { name: "Dave D" },
      { name: "Eve E" },
    ]);

    const runA = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 5, seed: 1 },
    );
    const runB = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 5, seed: 2 },
    );

    // With 5 users and 2 different seeds the orders should differ for at least
    // one position (not a guaranteed statistical test, but reliably true here).
    const sameOrder = runA.every((m, i) => m.initials === runB[i]?.initials);
    expect(sameOrder).toBe(false);
  });

  test("returns exactly the requested count when enough users exist", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Alice A" },
      { name: "Bob B" },
      { name: "Carol C" },
      { name: "Dave D" },
      { name: "Eve E" },
    ]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 3, seed: 7 },
    );

    expect(result).toHaveLength(3);
  });

  test("returns what is available when fewer users than limit exist", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [{ name: "Alice A" }, { name: "Bob B" }]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 8, seed: 1 },
    );

    expect(result).toHaveLength(2);
  });

  test("clamps limit above 8 to 8", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(
      t,
      Array.from({ length: 10 }, (_, i) => ({ name: `User${i} X` })),
    );

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 999, seed: 0 },
    );

    expect(result.length).toBeLessThanOrEqual(8);
  });

  test("clamps limit below 1 to 1", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [{ name: "Alice A" }, { name: "Bob B" }]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 0, seed: 0 },
    );

    expect(result).toHaveLength(1);
  });

  test("inactive users are excluded", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Active User", isActive: true },
      { name: "Inactive User", isActive: false },
    ]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 8, seed: 0 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].initials).toBe("AU");
  });

  test("no consent → image is null in query result", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Sander Verkuil", avatar: "https://example.com/a.jpg" },
    ]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 1, seed: 0 },
    );

    expect(result[0].image).toBeNull();
  });

  test("shareAvatarPublicly: false → image is null in query result", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      {
        name: "Sander Verkuil",
        avatar: "https://example.com/a.jpg",
        shareAvatarPublicly: false,
      },
    ]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 1, seed: 0 },
    );

    expect(result[0].image).toBeNull();
  });

  test("shareAvatarPublicly: true + avatar → image equals avatar URL in query result", async () => {
    const url = "https://example.com/avatar.jpg";
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Sander Verkuil", avatar: url, shareAvatarPublicly: true },
    ]);

    const result = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 1, seed: 0 },
    );

    expect(result[0].image).toBe(url);
  });
});

// SEC-90 (PRIV-18, SURF-12): this read is unauthenticated, so it samples only members who
// explicitly chose a public profile (explicitVisibilityOf), and their initials come from the name
// they show publicly.
describe("insights.getCommunityAvatars — explicit public profiles only (SEC-90)", () => {
  const sample = (t: TestConvex<typeof schema>, seed: number) =>
    t.query(api.insights.getCommunityAvatars.getCommunityAvatars, {
      limit: 8,
      seed,
    });

  test("members with no profile row, a private one or no visibility choice are never sampled", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Nora Norow", profile: null },
      { name: "Nils Norow", profile: null },
      { name: "Pia Private", profile: { visibility: "private" } },
      { name: "Piet Private", profile: { visibility: "private" } },
      { name: "Uma Unset", profile: { displayName: "Uma" } },
      { name: "Alice Public" },
      { name: "Bob Public" },
    ]);

    for (const seed of [0, 1, 2, 3, 42]) {
      const result = await sample(t, seed);
      expect(result.map((m) => m.initials).sort()).toEqual(["AP", "BP"]);
    }
  });

  test("walks past hidden members to fill the requested count", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `Hidden${i} X`,
        profile: { visibility: "private" as const },
      })),
      { name: "Alice Public" },
      { name: "Bob Public" },
      { name: "Carol Public" },
    ]);

    for (const seed of [0, 7, 99]) {
      const result = await t.query(
        api.insights.getCommunityAvatars.getCommunityAvatars,
        { limit: 3, seed },
      );
      expect(result.map((m) => m.initials).sort()).toEqual(["AP", "BP", "CP"]);
    }
  });

  test("returns nothing when no member chose a public profile", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      { name: "Nora Norow", profile: null },
      { name: "Pia Private", profile: { visibility: "private" } },
    ]);

    expect(await sample(t, 0)).toEqual([]);
  });

  test("initials come from the public display name, not the account name", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t, [
      {
        name: "Sander Verkuil",
        profile: { visibility: "public", displayName: "Puzzle Fox" },
      },
    ]);

    expect((await sample(t, 0)).map((m) => m.initials)).toEqual(["PF"]);
  });

  test("a public member's avatar still needs shareAvatarPublicly", async () => {
    const url = "https://example.com/avatar.jpg";
    const t = convexTest(schema, modules);
    await seedUsers(t, [{ name: "Alice Public", avatar: url }]);

    expect(await sample(t, 0)).toEqual([{ initials: "AP", image: null }]);
  });
});
