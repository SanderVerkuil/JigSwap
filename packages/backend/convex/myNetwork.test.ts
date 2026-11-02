import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// social.myNetwork: the People page's network, a page at a time (PERF-B13). One entry per person in
// either follow direction, newest edge first. "Follows you" comes from the follow pair itself, so it
// is right however many followers the member has.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const addUsers = (t: T, names: string[]) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"users">[] = [];
    for (const name of names) {
      ids.push(
        await ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return ids;
  });

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: Date.now(),
    }),
  );

const page = (t: T, who: string, numItems = 50, cursor: string | null = null) =>
  t
    .withIdentity({ subject: `clerk_${who}` })
    .query(api.social.listMyNetwork.listMyNetwork, {
      paginationOpts: { numItems, cursor },
    });

let t: T;
let ann: Id<"users">;
let bob: Id<"users">;
let cleo: Id<"users">;
let dan: Id<"users">;

beforeEach(async () => {
  t = convexTest(schema, modules);
  [ann, bob, cleo, dan] = await addUsers(t, ["ann", "bob", "cleo", "dan"]);
});

describe("social.myNetwork", () => {
  test("requires a signed-in member", async () => {
    await expect(
      t.query(api.social.listMyNetwork.listMyNetwork, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("lists both directions, newest edge first, a mutual pair once", async () => {
    await follow(t, ann, bob); // Ann follows Bob...
    await follow(t, cleo, ann); // ...Cleo follows Ann...
    await follow(t, ann, dan); // ...and Ann and Dan follow each other.
    await follow(t, dan, ann);

    const { page: rows, isDone } = await page(t, "ann");
    expect(isDone).toBe(true);
    expect(rows.map((row) => [row.memberId, row.followsYou])).toEqual([
      [dan, true],
      [cleo, true],
      [bob, false],
    ]);
  });

  test("pages through the network without repeats or holes", async () => {
    const others = await addUsers(
      t,
      Array.from({ length: 7 }, (_, i) => `m${i}`),
    );
    for (const [i, id] of others.entries()) {
      if (i % 2 === 0) await follow(t, ann, id);
      else await follow(t, id, ann);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: Awaited<ReturnType<typeof page>> = await page(
        t,
        "ann",
        3,
        cursor,
      );
      seen.push(...result.page.map((row) => row.memberId));
      if (result.isDone) break;
      expect(result.page).toHaveLength(3);
      cursor = result.continueCursor;
    }
    expect(seen).toEqual([...others].reverse());
  });

  test("'Follows you' stays right past the old 500-follower window", async () => {
    await follow(t, bob, ann);
    await follow(t, ann, bob);
    const fans = await addUsers(
      t,
      Array.from({ length: 501 }, (_, i) => `fan${i}`),
    );
    await t.run(async (ctx) => {
      for (const id of fans) {
        await ctx.db.insert("follows", {
          followerId: id,
          followeeId: ann,
          createdAt: Date.now(),
        });
      }
    });

    let cursor: string | null = null;
    for (;;) {
      const result: Awaited<ReturnType<typeof page>> = await page(
        t,
        "ann",
        50,
        cursor,
      );
      const entry = result.page.find((row) => row.memberId === bob);
      if (entry) {
        expect(entry.followsYou).toBe(true);
        return;
      }
      expect(result.isDone).toBe(false);
      cursor = result.continueCursor;
    }
  });

  test("a member blocked either way drops out, and the page stays full", async () => {
    await follow(t, ann, bob);
    await follow(t, cleo, ann);
    await follow(t, ann, dan);
    await t.run(async (ctx) => {
      await ctx.db.insert("blocks", {
        blockerId: ann,
        blockedId: dan,
        createdAt: Date.now(),
      });
      await ctx.db.insert("blocks", {
        blockerId: cleo,
        blockedId: ann,
        createdAt: Date.now(),
      });
    });
    const { page: rows, isDone } = await page(t, "ann", 1);
    expect(rows.map((row) => row.memberId)).toEqual([bob]);
    expect(isDone).toBe(false);
  });

  test("clamps the page size", async () => {
    const others = await addUsers(
      t,
      Array.from({ length: 60 }, (_, i) => `m${i}`),
    );
    for (const id of others) await follow(t, ann, id);
    expect((await page(t, "ann", 1000)).page.length).toBeLessThanOrEqual(50);
    expect((await page(t, "ann", 0)).page).toHaveLength(1);
  });

  test("names nobody else's network: another member's follows stay out", async () => {
    await follow(t, bob, cleo);
    expect((await page(t, "ann")).page).toEqual([]);
  });
});

describe("the bounded follow lists know about the other direction", () => {
  const followees = (who: string) =>
    t
      .withIdentity({ subject: `clerk_${who}` })
      .query(api.social.listFollowees.listFollowees, {});
  const followers = (who: string) =>
    t
      .withIdentity({ subject: `clerk_${who}` })
      .query(api.social.listFollowers.listFollowers, {});

  test("a followee says whether they follow back, a follower whether you follow them", async () => {
    await follow(t, ann, bob);
    await follow(t, bob, ann);
    await follow(t, ann, cleo);
    await follow(t, dan, ann);

    const out = await followees("ann");
    expect(out.find((e) => e.memberId === bob)?.followsYou).toBe(true);
    expect(out.find((e) => e.memberId === cleo)?.followsYou).toBe(false);

    const incoming = await followers("ann");
    expect(incoming.find((e) => e.memberId === bob)?.youFollow).toBe(true);
    expect(incoming.find((e) => e.memberId === dan)?.youFollow).toBe(false);
  });
});
