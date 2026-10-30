import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-24: a propose -> cancel loop opened a new thread (and a trade_request notification) with the
// copy's owner on every cycle, with no limit. Proposals are now capped per member (an hourly and a
// daily bucket) and per (initiator, owner) pair over a week. The pair bucket is only charged once
// the copy has passed the reachability gate, so a refusal on a copy the initiator can't see never
// says anything about who owns it.

type T = TestConvex<typeof schema>;

const FOR_SALE = { forTrade: false, forSale: true, forLend: false };
const NOT_OFFERED = { forTrade: false, forSale: false, forLend: false };

const seed = (t: T) =>
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
    const attacker = await mkUser("clerk_attacker");
    // Owners have no profile row, so they are public: their open copies are reachable.
    const owner = await mkUser("clerk_owner");
    const other = await mkUser("clerk_other");
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (
      ownerId: Id<"users">,
      availability: typeof FOR_SALE | typeof NOT_OFFERED,
    ) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });
    return {
      attacker,
      owner,
      other,
      copyA: await mkCopy(owner, FOR_SALE),
      copyB: await mkCopy(owner, FOR_SALE),
      // Not offered for anything: a stranger can't reach it.
      hiddenCopy: await mkCopy(owner, NOT_OFFERED),
      otherCopy: await mkCopy(other, FOR_SALE),
    };
  });

const asAttacker = (t: T) => t.withIdentity({ subject: "clerk_attacker" });

const propose = (t: T, copy: Id<"ownedPuzzles">) =>
  asAttacker(t).mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 10,
  });

const cancel = (t: T, exchangeId: string) =>
  asAttacker(t).mutation(api.exchange.cancel.cancel, { exchangeId });

const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const errorCodeOf = async (
  p: Promise<unknown>,
): Promise<string | undefined> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    const data = (e as ConvexError<Value>).data;
    const parsed = (typeof data === "string" ? JSON.parse(data) : data) as {
      code?: string;
    };
    return parsed.code;
  }
  throw new Error("expected the call to reject");
};

const exchangeCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("exchanges").collect()).length);

const threadSeatsOf = (t: T, memberId: Id<"users">) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("threadParticipants")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()
      ).length,
  );

const spend = (t: T, name: keyof typeof RATE_LIMITS, subject: string) =>
  t.run(async (ctx) => {
    for (let i = 0; i < RATE_LIMITS[name].max; i++) {
      await enforceRateLimit(ctx, name, subject);
    }
  });

describe("exchange.propose rate limits", () => {
  test("a propose/cancel loop on one owner stops at the per-pair cap", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const cap = RATE_LIMITS.exchangePair.max;

    for (let i = 0; i < cap; i++) {
      const exchangeId = await propose(t, s.copyA);
      await cancel(t, exchangeId);
    }
    await flush(t);

    expect(await errorCodeOf(propose(t, s.copyA))).toBe("RateLimited");
    // Every copy of that owner counts against the same pair.
    expect(await errorCodeOf(propose(t, s.copyB))).toBe("RateLimited");
    await flush(t);

    // The refused attempts wrote nothing: one exchange and one thread per allowed cycle.
    expect(await exchangeCount(t)).toBe(cap);
    expect(await threadSeatsOf(t, s.owner)).toBe(cap);
  });

  test("the pair cap is per owner: another owner's copy can still be requested", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await spend(t, "exchangePair", `${s.attacker}:${s.owner}`);

    expect(await errorCodeOf(propose(t, s.copyA))).toBe("RateLimited");
    await expect(propose(t, s.otherCopy)).resolves.toEqual(expect.any(String));
    await flush(t);
  });

  test("an unreachable copy is refused as unreachable, even when the pair is spent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await spend(t, "exchangePair", `${s.attacker}:${s.owner}`);

    // RateLimited here would tell the attacker that the hidden copy belongs to this owner.
    expect(await errorCodeOf(propose(t, s.hiddenCopy))).toBe(
      "CopyNotReachable",
    );
  });

  test("refused attempts on an unreachable copy don't use up the pair", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (let i = 0; i < 3; i++) {
      expect(await errorCodeOf(propose(t, s.hiddenCopy))).toBe(
        "CopyNotReachable",
      );
    }

    for (let i = 0; i < RATE_LIMITS.exchangePair.max; i++) {
      await cancel(t, await propose(t, s.copyA));
    }
    expect(await errorCodeOf(propose(t, s.copyA))).toBe("RateLimited");
    await flush(t);
  });

  test("the hourly member bucket caps proposals across owners", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await spend(t, "exchangePropose", s.attacker);

    expect(await errorCodeOf(propose(t, s.otherCopy))).toBe("RateLimited");
    expect(await exchangeCount(t)).toBe(0);
  });

  test("the daily member bucket caps proposals across owners", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await spend(t, "exchangeProposeDaily", s.attacker);

    expect(await errorCodeOf(propose(t, s.otherCopy))).toBe("RateLimited");
    expect(await exchangeCount(t)).toBe(0);
  });
});
