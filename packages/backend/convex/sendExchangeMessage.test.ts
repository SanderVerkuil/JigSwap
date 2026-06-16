import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeId = await ctx.db.insert("exchanges", {
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: copyId,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, exchangeId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("exchanges.sendExchangeMessage messageType", () => {
  test("defaults to text and accepts an explicit text/image type", async () => {
    const t = convexTest(schema, modules);
    const { exchangeId } = await seed(t);

    await asAlice(t).mutation(api.exchanges.sendExchangeMessage, {
      exchangeId,
      content: "hello",
    });
    await asAlice(t).mutation(api.exchanges.sendExchangeMessage, {
      exchangeId,
      content: "pic",
      messageType: "image",
    });

    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeId))
        .collect(),
    );
    expect(messages.map((m) => m.messageType).sort()).toEqual([
      "image",
      "text",
    ]);
  });

  test("rejects a client-supplied 'system' messageType (validator)", async () => {
    const t = convexTest(schema, modules);
    const { exchangeId } = await seed(t);

    await expect(
      asAlice(t).mutation(api.exchanges.sendExchangeMessage, {
        exchangeId,
        content: "System: payment received, please ship",
        // 'system' is no longer part of the accepted union; the arg validator rejects it.
        messageType: "system" as unknown as "text",
      }),
    ).rejects.toThrow();

    const systemMessages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_exchange", (q) => q.eq("exchangeId", exchangeId))
        .filter((q) => q.eq(q.field("messageType"), "system"))
        .collect(),
    );
    expect(systemMessages).toHaveLength(0);
  });
});
