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

// t.run's return value round-trips through Convex value normalization, which turns a bare
// `undefined` into `null` — so fetch the whole doc inside t.run and destructure OUTSIDE it,
// where an absent `slug` key genuinely reads back as `undefined`.
const getSlug = async (t: ReturnType<typeof convexTest>, userId: string) => {
  const doc = await t.run(async (ctx) => ctx.db.get(userId as never));
  return doc?.slug;
};

describe("setSlug", () => {
  test("sets a valid slug", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "sander-verkuil",
    });

    expect(await getSlug(t, alice)).toBe("sander-verkuil");
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.mutation(api.identity.setSlug.setSlug, { slug: "someone" }),
    ).rejects.toThrow(ConvexError);
  });

  describe("format rejections", () => {
    const cases: Array<[string, string]> = [
      ["uppercase", "Sander"],
      ["too short", "ab"],
      ["leading hyphen", "-sander"],
      ["trailing hyphen", "sander-"],
      ["double hyphen", "san--der"],
      ["spaces", "san der"],
    ];

    test.each(cases)("rejects %s (%s)", async (_label, candidate) => {
      const t = convexTest(schema, modules);
      await seed(t);

      await expect(
        asAlice(t).mutation(api.identity.setSlug.setSlug, {
          slug: candidate,
        }),
      ).rejects.toThrow(ConvexError);
    });
  });

  test("rejects a reserved word", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      asAlice(t).mutation(api.identity.setSlug.setSlug, { slug: "admin" }),
    ).rejects.toThrow(ConvexError);
  });

  test("rejects a slug shaped like a Convex id", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    await expect(
      asAlice(t).mutation(api.identity.setSlug.setSlug, { slug: bob }),
    ).rejects.toThrow(ConvexError);
  });

  test("a second member cannot take an already-held slug", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });

    await expect(
      asBob(t).mutation(api.identity.setSlug.setSlug, { slug: "puzzler" }),
    ).rejects.toThrow(ConvexError);
  });

  test("a member re-setting their own already-held slug is fine", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });
    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });

    expect(await getSlug(t, alice)).toBe("puzzler");
  });

  test("clearing with null unsets the slug", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });
    await asAlice(t).mutation(api.identity.setSlug.setSlug, { slug: null });

    expect(await getSlug(t, alice)).toBeUndefined();
  });

  test("clearing frees the slug for another member to take", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });
    await asAlice(t).mutation(api.identity.setSlug.setSlug, { slug: null });

    await asBob(t).mutation(api.identity.setSlug.setSlug, {
      slug: "puzzler",
    });
    expect(await getSlug(t, bob)).toBe("puzzler");
  });

  test("a member cannot set their slug to another member's username (handle-shadowing)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    // Give alice a Clerk-owned username so bob can attempt to shadow it.
    await t.run(async (ctx) => {
      await ctx.db.patch(alice, { username: "alice" });
    });

    await expect(
      asBob(t).mutation(api.identity.setSlug.setSlug, { slug: "alice" }),
    ).rejects.toThrow(ConvexError);
  });

  test("a member CAN set their slug equal to their own username", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(alice, { username: "alice" });
    });

    await asAlice(t).mutation(api.identity.setSlug.setSlug, {
      slug: "alice",
    });

    expect(await getSlug(t, alice)).toBe("alice");
  });
});
