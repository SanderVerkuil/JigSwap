import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-80: the ConnectionPolicy's pair-thread clause counts only for a partner the initiator may
// see. Before, canMessage / openDmThread answered true for ANY pair thread, so a requester whose
// exchange partner is anonymous could probe candidate member ids and confirm who that partner is.
// A hidden or departed partner now answers exactly like a stranger (false / NotConnected).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Visibility = "public" | "private";

// Alice initiates. Bob is her exchange partner (a pair thread exists, no follows, no circle).
// Carol is an unrelated private stranger: the answer for bob must match hers when bob is hidden.
const seed = (t: T, bobVisibility: Visibility) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        name,
        username: name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    await ctx.db.insert("profiles", {
      memberId: bob,
      visibility: bobVisibility,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: carol,
      visibility: "private",
      updatedAt: now,
    });
    await ctx.db.insert("threads", {
      aggregateId: crypto.randomUUID(),
      subjectKind: "exchange",
      participants: [alice, bob],
      participantsKey: [alice, bob].sort().join("|"),
      createdAt: now,
    });
    return { alice, bob, carol };
  });

const followMutually = (t: T, a: Id<"users">, b: Id<"users">) =>
  t.run(async (ctx) => {
    for (const [followerId, followeeId] of [
      [a, b],
      [b, a],
    ] as const) {
      await ctx.db.insert("follows", {
        followerId,
        followeeId,
        createdAt: Date.now(),
      });
    }
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });

const canMessage = (t: T, recipientId: Id<"users">) =>
  asAlice(t).query(api.conversation.canMessage.canMessage, { recipientId });

const openDm = (t: T, recipientId: Id<"users">) =>
  asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId,
  });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  const parsed: { code?: string } =
    typeof data === "string" ? JSON.parse(data) : (data as { code?: string });
  return parsed.code;
};

const expectNotConnected = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(codeOf(error)).toBe("NotConnected");
};

const dmCount = (t: T) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("threads")
          .withIndex("by_subject_participants", (q) =>
            q.eq("subjectKind", "dm"),
          )
          .collect()
      ).length,
  );

describe("a pair thread with a partner anonymous to the initiator", () => {
  test("canMessage answers false, the same as for a stranger", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    expect(await canMessage(t, u.bob)).toBe(false);
    expect(await canMessage(t, u.carol)).toBe(false);
  });

  test("openDmThread refuses with NotConnected and opens nothing", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    await expectNotConnected(openDm(t, u.bob));
    await expectNotConnected(openDm(t, u.carol));
    expect(await dmCount(t)).toBe(0);
  });

  test("a departed partner answers like a stranger too", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "public");
    await t.run((ctx) => ctx.db.patch(u.bob, { isActive: false }));
    expect(await canMessage(t, u.bob)).toBe(false);
    await expectNotConnected(openDm(t, u.bob));
  });
});

describe("a pair thread with a partner the initiator may see", () => {
  test("a public partner: canMessage is true and the DM opens", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "public");
    expect(await canMessage(t, u.bob)).toBe(true);
    expect(typeof (await openDm(t, u.bob))).toBe("string");
    expect(await dmCount(t)).toBe(1);
  });

  test("a private mutual follower: canMessage is true and the DM opens", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    await followMutually(t, u.alice, u.bob);
    expect(await canMessage(t, u.bob)).toBe(true);
    expect(typeof (await openDm(t, u.bob))).toBe("string");
  });
});
