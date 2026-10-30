import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-23: follow, unfollow and request/cancel loops are rate limited (a member bucket for every
// toggle, a per-pair bucket for the follows and requests that notify the target), and a follow
// request that is no longer pending when its event is dispatched notifies nobody.

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
    const attacker = await mkUser("clerk_attacker");
    const victim = await mkUser("clerk_victim");
    const open = await mkUser("clerk_open");
    // The victim's profile is private (requests); `open` has no profile row (public).
    await ctx.db.insert("profiles", {
      aggregateId: "profile-victim",
      memberId: victim,
      displayName: "Victim",
      visibility: "private",
      updatedAt: now,
    });
    return { attacker, victim, open };
  });

const asAttacker = (t: T) => t.withIdentity({ subject: "clerk_attacker" });
const asOpen = (t: T) => t.withIdentity({ subject: "clerk_open" });

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

const notificationsOf = (t: T, userId: Id<"users">, type: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((n) => n.type === type),
  );

const followRequestRows = (t: T) =>
  t.run((ctx) => ctx.db.query("followRequests").collect());

describe("follow loops are rate limited", () => {
  test("a request/cancel loop on a private member stops at the per-pair cap", async () => {
    const t = convexTest(schema, modules);
    const { victim } = await seed(t);
    const cap = RATE_LIMITS.followPair.max;

    for (let i = 0; i < cap; i++) {
      const requested = await asAttacker(t).mutation(
        api.social.followMember.followMember,
        { followeeId: victim },
      );
      expect(requested.kind).toBe("requested");
      await flush(t);
      await asAttacker(t).mutation(
        api.social.cancelFollowRequest.cancelFollowRequest,
        { requestId: requested.id },
      );
    }

    expect(
      await errorCodeOf(
        asAttacker(t).mutation(api.social.followMember.followMember, {
          followeeId: victim,
        }),
      ),
    ).toBe("RateLimited");
    await flush(t);
    // The refused attempt wrote nothing: no request row, no extra notification.
    expect(await followRequestRows(t)).toHaveLength(0);
    expect(
      await notificationsOf(t, victim, "follow_request_received"),
    ).toHaveLength(cap);
  });

  test("a follow/unfollow loop on a public member stops at the per-pair cap", async () => {
    const t = convexTest(schema, modules);
    const { open } = await seed(t);
    const cap = RATE_LIMITS.followPair.max;

    for (let i = 0; i < cap; i++) {
      const followed = await asAttacker(t).mutation(
        api.social.followMember.followMember,
        { followeeId: open },
      );
      expect(followed.kind).toBe("followed");
      await asAttacker(t).mutation(api.social.unfollowMember.unfollowMember, {
        followeeId: open,
      });
    }

    expect(
      await errorCodeOf(
        asAttacker(t).mutation(api.social.followMember.followMember, {
          followeeId: open,
        }),
      ),
    ).toBe("RateLimited");
    await flush(t);
  });

  test("the pair cap is per target: another member can still be followed", async () => {
    const t = convexTest(schema, modules);
    const { attacker, victim, open } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < RATE_LIMITS.followPair.max; i++) {
        await enforceRateLimit(ctx, "followPair", `${attacker}:${victim}`);
      }
    });

    const followed = await asAttacker(t).mutation(
      api.social.followMember.followMember,
      { followeeId: open },
    );
    expect(followed.kind).toBe("followed");
    await flush(t);
  });

  test("the member bucket caps follow, unfollow and cancel alike", async () => {
    const t = convexTest(schema, modules);
    const { attacker, victim, open } = await seed(t);
    // A live pending request and a live follow edge to undo, set up before the bucket is spent.
    const requested = await asAttacker(t).mutation(
      api.social.followMember.followMember,
      { followeeId: victim },
    );
    await asAttacker(t).mutation(api.social.followMember.followMember, {
      followeeId: open,
    });
    await t.run(async (ctx) => {
      const spent = RATE_LIMITS.followToggle.max - 2;
      for (let i = 0; i < spent; i++) {
        await enforceRateLimit(ctx, "followToggle", attacker);
      }
    });

    expect(
      await errorCodeOf(
        asAttacker(t).mutation(api.social.unfollowMember.unfollowMember, {
          followeeId: open,
        }),
      ),
    ).toBe("RateLimited");
    expect(
      await errorCodeOf(
        asAttacker(t).mutation(
          api.social.cancelFollowRequest.cancelFollowRequest,
          { requestId: requested.id },
        ),
      ),
    ).toBe("RateLimited");
    expect(
      await errorCodeOf(
        asAttacker(t).mutation(api.social.followMember.followMember, {
          followeeId: victim,
        }),
      ),
    ).toBe("RateLimited");
    // Nothing was undone by the refused calls.
    expect((await followRequestRows(t)).map((r) => r.status)).toEqual([
      "pending",
    ]);
    await flush(t);
  });

  test("follow back from a notification is charged against the same pair cap", async () => {
    const t = convexTest(schema, modules);
    const { attacker, open } = await seed(t);
    await asAttacker(t).mutation(api.social.followMember.followMember, {
      followeeId: open,
    });
    await flush(t);
    const [notification] = await notificationsOf(t, open, "new_follower");
    const notificationId = notification?.aggregateId;
    if (!notificationId) throw new Error("setup: no new_follower");
    await t.run(async (ctx) => {
      for (let i = 0; i < RATE_LIMITS.followPair.max; i++) {
        await enforceRateLimit(ctx, "followPair", `${open}:${attacker}`);
      }
    });

    expect(
      await errorCodeOf(
        asOpen(t).mutation(api.notifications.act.act, {
          notificationId,
          action: "follow_back",
        }),
      ),
    ).toBe("RateLimited");
    await flush(t);
  });
});

describe("follow request notifications", () => {
  test("a request cancelled before its event is dispatched notifies nobody", async () => {
    const t = convexTest(schema, modules);
    const { victim } = await seed(t);

    const requested = await asAttacker(t).mutation(
      api.social.followMember.followMember,
      { followeeId: victim },
    );
    await asAttacker(t).mutation(
      api.social.cancelFollowRequest.cancelFollowRequest,
      { requestId: requested.id },
    );
    await flush(t);

    expect(
      await notificationsOf(t, victim, "follow_request_received"),
    ).toHaveLength(0);
  });

  test("a request still pending at dispatch notifies the target", async () => {
    const t = convexTest(schema, modules);
    const { victim } = await seed(t);

    await asAttacker(t).mutation(api.social.followMember.followMember, {
      followeeId: victim,
    });
    await flush(t);

    expect(
      await notificationsOf(t, victim, "follow_request_received"),
    ).toHaveLength(1);
  });
});
