import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-14 input side (review repro SOC-6): editProfile refused nothing but an empty name, so a
// 130 KB display name and a 200 KB bio were stored and copied into follower lists and
// notification rows. The display name is now cleaned (no bidi or control characters) and capped
// at 50 characters, the bio at 500; profiles stored before the caps keep working.

type T = TestConvex<typeof schema>;

const RLO = String.fromCharCode(0x202e);
const PDF = String.fromCharCode(0x202c);

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });

const seedAlice = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const e = await p.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(ConvexError);
  const data = (e as ConvexError<Value>).data;
  return typeof data === "object" && data !== null && "code" in data
    ? String(data.code)
    : undefined;
};

const profileRowOf = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
  );

const editProfile = (t: T, args: { displayName?: string; bio?: string }) =>
  asAlice(t).mutation(api.social.editProfile.editProfile, args);

describe("editProfile caps the display name and bio (SEC-14)", () => {
  test("a 130 KB display name is refused, on first save and on an edit", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedAlice(t);
    const huge = "N".repeat(130_000);

    expect(await codeOf(editProfile(t, { displayName: huge }))).toBe(
      "InvalidDisplayName",
    );
    expect(await profileRowOf(t, alice)).toBeNull();

    await editProfile(t, { displayName: "Alice" });
    expect(await codeOf(editProfile(t, { displayName: huge }))).toBe(
      "InvalidDisplayName",
    );
    expect((await profileRowOf(t, alice))?.displayName).toBe("Alice");
  });

  test("a 200 KB bio is refused, on first save and on an edit", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedAlice(t);
    const huge = "B".repeat(200_000);

    expect(await codeOf(editProfile(t, { bio: huge }))).toBe("BioTooLong");
    expect(await profileRowOf(t, alice)).toBeNull();

    await editProfile(t, { bio: "Story" });
    expect(await codeOf(editProfile(t, { bio: huge }))).toBe("BioTooLong");
    expect((await profileRowOf(t, alice))?.bio).toBe("Story");
  });

  test("a name at the cap is stored, cleaned of bidi overrides and line breaks", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedAlice(t);

    await editProfile(t, {
      displayName: `${RLO}JigSwap\nSecurity${PDF}`,
      bio: `  ${"b".repeat(500)}  `,
    });
    const row = await profileRowOf(t, alice);
    expect(row?.displayName).toBe("JigSwap Security");
    expect(row?.bio).toBe("b".repeat(500));
  });
});

describe("profiles stored before the caps stay editable", () => {
  const LEGACY_NAME = "L".repeat(120);
  const LEGACY_BIO = "B".repeat(2_000);

  const seedLegacy = async (t: T) => {
    const alice = await seedAlice(t);
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        aggregateId: "profile-legacy",
        memberId: alice,
        displayName: LEGACY_NAME,
        bio: LEGACY_BIO,
        updatedAt: Date.now(),
      }),
    );
    return alice;
  };

  test("a bio-only save keeps the over-long name instead of failing on the stored row", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedLegacy(t);

    await editProfile(t, { bio: "Shorter story" });
    const row = await profileRowOf(t, alice);
    expect(row?.displayName).toBe(LEGACY_NAME);
    expect(row?.bio).toBe("Shorter story");
  });

  test("resending the stored name and bio unchanged is accepted", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedLegacy(t);

    await editProfile(t, { displayName: LEGACY_NAME, bio: LEGACY_BIO });
    const row = await profileRowOf(t, alice);
    expect(row?.displayName).toBe(LEGACY_NAME);
    expect(row?.bio).toBe(LEGACY_BIO);
  });

  test("a changed name over the cap is still refused", async () => {
    const t = convexTest(schema, modules);
    await seedLegacy(t);

    expect(
      await codeOf(
        editProfile(t, { displayName: `${LEGACY_NAME}x`, bio: LEGACY_BIO }),
      ),
    ).toBe("InvalidDisplayName");
  });

  test("other profile mutations still load the stored row", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedLegacy(t);

    await asAlice(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );
    const row = await profileRowOf(t, alice);
    expect(row?.visibility).toBe("private");
    expect(row?.displayName).toBe(LEGACY_NAME);
  });
});
