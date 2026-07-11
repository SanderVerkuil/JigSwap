import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const NO_AVAILABILITY = { forTrade: false, forSale: false, forLend: false };

// Four members: public-with-username (2 copies, consented avatar), public-without-username,
// private-with-username (avatar NOT consented), and an inactive member.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Partial<{
        username: string;
        avatar: string;
        bio: string;
        location: string;
        shareAvatarPublicly: boolean;
        isActive: boolean;
      }> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: extra.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    const alice = await mkUser("clerk_alice", "Alice", {
      username: "alice",
      avatar: "https://img.example/alice.png",
      bio: "I love gradients",
      location: "Utrecht",
      shareAvatarPublicly: true,
    });
    const bob = await mkUser("clerk_bob", "Bob"); // public by default, no username
    const carol = await mkUser("clerk_carol", "Carol", {
      username: "carol",
      avatar: "https://img.example/carol.png",
      bio: "secret bio",
      location: "Amsterdam",
      // No shareAvatarPublicly: avatar must NOT reach anonymous callers.
    });
    const dave = await mkUser("clerk_dave", "Dave", {
      username: "dave",
      isActive: false,
    });

    await ctx.db.insert("profiles", {
      memberId: carol,
      displayName: "Carol de Puzzelaar",
      visibility: "private",
      updatedAt: now,
    });

    // Two copies for Alice so puzzleCount is exercised.
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzle,
      ownerId: alice,
      condition: "good",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId: puzzle,
      ownerId: alice,
      condition: "fair",
      availability: NO_AVAILABILITY,
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, carol, dave };
  });

describe("getPublicMemberTeaser", () => {
  test("resolves a username for an anonymous caller (public member)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "alice" },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.memberId).toBe(alice);
    expect(teaser!.displayName).toBe("Alice");
    expect(teaser!.username).toBe("alice");
    expect(teaser!.visibility).toBe("public");
    expect(teaser!.puzzleCount).toBe(2);
    // Consented: avatar visible to anonymous callers.
    expect(teaser!.avatar).toBe("https://img.example/alice.png");
    // The payload never carries bio/location — assert at the object level.
    expect(teaser).not.toHaveProperty("bio");
    expect(teaser).not.toHaveProperty("location");
  });

  test("falls back to the users id when the handle is not a username", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: bob },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.memberId).toBe(bob);
    expect(teaser!.username).toBeUndefined();
  });

  test("unknown handle and inactive member both return null", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, {
        handle: "nobody-here",
      }),
    ).toBeNull();
    expect(
      await t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, {
        handle: "dave",
      }),
    ).toBeNull();
  });

  test("private member: named, but no puzzleCount and no unconsented avatar (anonymous caller)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "carol" },
    );
    expect(teaser).not.toBeNull();
    // Deliberate: a private member IS named on their own direct link (spec decision),
    // with the profile displayName preferred over the account name.
    expect(teaser!.displayName).toBe("Carol de Puzzelaar");
    expect(teaser!.visibility).toBe("private");
    expect(teaser!.puzzleCount).toBeNull();
    // No shareAvatarPublicly consent -> anonymous callers never see the avatar.
    expect(teaser!.avatar).toBeUndefined();
    expect(teaser).not.toHaveProperty("bio");
    expect(teaser).not.toHaveProperty("location");
  });

  test("authenticated caller sees the avatar without public consent (in-app parity)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const teaser = await asAlice.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "carol" },
    );
    expect(teaser).not.toBeNull();
    expect(teaser!.avatar).toBe("https://img.example/carol.png");
  });
});
