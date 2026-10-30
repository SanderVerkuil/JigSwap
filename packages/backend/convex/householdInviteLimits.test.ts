import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-24: revoking a household invite deletes it, so invite -> revoke (or invite -> decline) could
// loop without end, notifying the invitee every time. Invites are now capped per member (daily)
// and per (household, invitee) over a week, which doubles as the re-invite cooldown after a revoke
// or a decline. A member the admin can't invite (missing, or blocked either way) still reads as
// MemberNotFound, never as RateLimited.

type T = TestConvex<typeof schema>;

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
    return {
      ann: await mkUser("clerk_ann"),
      bob: await mkUser("clerk_bob"),
      cat: await mkUser("clerk_cat"),
    };
  });

const as = (t: T, who: "ann" | "bob" | "cat") =>
  t.withIdentity({ subject: `clerk_${who}` });

// Ann founds a household (she is its admin); returns its id.
const annFoundsHousehold = async (t: T, ann: Id<"users">) => {
  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const membership = await t.run((ctx) =>
    ctx.db
      .query("householdMembers")
      .withIndex("by_member", (q) => q.eq("memberId", ann))
      .unique(),
  );
  if (!membership) throw new Error("setup: no household");
  return membership.householdId;
};

const invite = (t: T, inviteeId: Id<"users">) =>
  as(t, "ann").mutation(api.household.inviteToHousehold.inviteToHousehold, {
    inviteeId,
  });

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

const invitesTo = (t: T, inviteeId: Id<"users">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("householdInvites").collect()).filter(
      (row) => row.inviteeId === inviteeId,
    ),
  );

const spend = (t: T, name: keyof typeof RATE_LIMITS, subject: string) =>
  t.run(async (ctx) => {
    for (let i = 0; i < RATE_LIMITS[name].max; i++) {
      await enforceRateLimit(ctx, name, subject);
    }
  });

describe("household invite rate limits", () => {
  test("an invite/revoke or invite/decline loop on one member stops at the per-pair cap", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    await annFoundsHousehold(t, ann);
    const cap = RATE_LIMITS.householdInvitePair.max;

    for (let i = 0; i < cap; i++) {
      const inviteId = await invite(t, bob);
      await flush(t);
      if (i % 2 === 0) {
        await as(t, "ann").mutation(
          api.household.revokeHouseholdInvite.revokeHouseholdInvite,
          { inviteId },
        );
      } else {
        await as(t, "bob").mutation(
          api.household.declineHouseholdInvite.declineHouseholdInvite,
          { inviteId },
        );
      }
    }

    // Revoked or declined, the invite is no longer pending: only the cap stops a new one.
    expect(await errorCodeOf(invite(t, bob))).toBe("RateLimited");
    await flush(t);
    expect(
      (await invitesTo(t, bob)).filter((row) => row.status === "pending"),
    ).toEqual([]);
  });

  test("the pair cap is per invitee: another member can still be invited", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob, cat } = await seed(t);
    const householdId = await annFoundsHousehold(t, ann);
    await spend(t, "householdInvitePair", `${householdId}:${bob}`);

    expect(await errorCodeOf(invite(t, bob))).toBe("RateLimited");
    await expect(invite(t, cat)).resolves.toEqual(expect.any(String));
    await flush(t);
  });

  test("a blocked member reads as missing, even with the pair spent", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    const householdId = await annFoundsHousehold(t, ann);
    await spend(t, "householdInvitePair", `${householdId}:${bob}`);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: ann,
        createdAt: Date.now(),
      }),
    );

    // RateLimited here would tell Ann that Bob exists and hasn't blocked her.
    expect(await errorCodeOf(invite(t, bob))).toBe("MemberNotFound");
  });

  test("the member bucket caps invites across invitees", async () => {
    const t = convexTest(schema, modules);
    const { ann, cat } = await seed(t);
    await annFoundsHousehold(t, ann);
    await spend(t, "householdInvite", ann);

    expect(await errorCodeOf(invite(t, cat))).toBe("RateLimited");
    expect(await invitesTo(t, cat)).toEqual([]);
  });
});
