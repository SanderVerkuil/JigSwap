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

  test("inactive member is also hidden when resolved by id (fallback branch)", async () => {
    const t = convexTest(schema, modules);
    const { dave } = await seed(t);
    expect(
      await t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, {
        handle: dave,
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

  test("authenticated non-mutual viewer of a private member still gets no puzzleCount", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Alice is signed in but is NOT a mutual follower of the private member Carol.
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    const teaser = await asAlice.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: "carol" },
    );
    expect(teaser).not.toBeNull();
    // puzzleCount is gated by visibility === "public" alone, regardless of auth.
    expect(teaser!.visibility).toBe("private");
    expect(teaser!.puzzleCount).toBeNull();
  });

  test("id URL is immune to username shadowing (id-first precedence)", async () => {
    const t = convexTest(schema, modules);
    // Two members: `target` is reachable by its id string; `shadower` sets its
    // username to `target`'s id string in an attempt to hijack the id URL.
    const { target, shadower } = await t.run(async (ctx) => {
      const now = Date.now();
      const target = await ctx.db.insert("users", {
        clerkId: "clerk_target",
        email: "target@example.com",
        name: "Target",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const shadower = await ctx.db.insert("users", {
        clerkId: "clerk_shadower",
        email: "shadower@example.com",
        name: "Shadower",
        username: target, // username equals the other member's id string
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return { target, shadower };
    });

    const teaser = await t.query(
      api.social.getPublicMemberTeaser.getPublicMemberTeaser,
      { handle: target },
    );
    expect(teaser).not.toBeNull();
    // Id resolution wins: the target member, never the username holder.
    expect(teaser!.memberId).toBe(target);
    expect(teaser!.memberId).not.toBe(shadower);
  });
});
