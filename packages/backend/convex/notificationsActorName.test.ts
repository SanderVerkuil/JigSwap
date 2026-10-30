import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { STRIP_ACTOR_NAMES_BATCH } from "./notifications/backfill";
import { pushTextOf } from "./notifications/copy";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A notification names its actor by REF (actorIds), resolved live for the recipient on every
// surface (bell, email, push). No name is copied into another member's row (SEC-68): a snapshot
// would outlive the actor's account deletion and their later renames. The resolved name follows
// the shared display-name rules: the member-chosen profile display name first, then the account
// name or username, and never the email (the recipient is another member).
const follow = async (follower: {
  name?: string;
  username?: string;
  displayName?: string;
}) => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const followerId = await ctx.db.insert("users", {
      clerkId: "clerk_follower",
      email: "follower@example.com",
      ...(follower.name ? { name: follower.name } : {}),
      ...(follower.username ? { username: follower.username } : {}),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const followeeId = await ctx.db.insert("users", {
      clerkId: "clerk_followee",
      email: "followee@example.com",
      name: "Followee",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: followerId,
      visibility: "public",
      ...(follower.displayName !== undefined
        ? { displayName: follower.displayName }
        : {}),
      updatedAt: now,
    });
    const eventId = await ctx.db.insert("domainEvents", {
      name: "MemberFollowed",
      payload: { followerId, followeeId },
      occurredAt: now,
      context: "social",
    });
    await handleDomainEvent(
      ctx,
      (await ctx.db.get(eventId)) as Doc<"domainEvents">,
    );
    return { followerId, followeeId };
  });
  const rows = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) =>
          q.eq("userId", ids.followeeId as Id<"users">),
        )
        .collect()
    ).filter((r) => r.type === "new_follower"),
  );
  const delivered = await t.query(
    internal.notifications.resolveForDelivery.resolveForDelivery,
    {
      recipientId: ids.followeeId,
      type: "new_follower",
      params: rows[0]?.params ?? {},
      relatedId: ids.followerId,
      actorId: ids.followerId,
    },
  );
  return { rows, delivered, followerId: ids.followerId };
};

describe("notifications subscriber actor name", () => {
  test("stores the actor as a ref, never a name snapshot", async () => {
    const { rows, followerId } = await follow({
      name: "Clerk Name",
      displayName: "Mara",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorIds).toEqual([followerId]);
    expect(rows[0].params?.actorName).toBeUndefined();
    expect(JSON.stringify(rows[0])).not.toContain("Mara");
    expect(JSON.stringify(rows[0])).not.toContain("Clerk Name");
  });

  test("delivery resolves the profile display name over the account name", async () => {
    const { delivered } = await follow({
      name: "Clerk Name",
      displayName: "Mara",
    });
    expect(delivered?.params.actorName).toBe("Mara");
  });

  // No snapshot is left to sanitise, so the rule holds where the live name leaves: the row carries
  // nothing, and the push text rendered from the delivery resolve is the inviterNameForEmail form.
  test("a long or bidi-laden name is not stored and reaches push sanitised and capped", async () => {
    const { rows, delivered } = await follow({
      displayName: `Mara \u202Eadmin\u202C ${"x".repeat(1000)}`,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].params?.actorName).toBeUndefined();
    expect(JSON.stringify(rows[0])).not.toContain("Mara");
    const { message } = pushTextOf("new_follower", delivered!);
    const name = message.replace(" started following you", "");
    expect(name.startsWith("Mara admin xxx")).toBe(true);
    expect(name).not.toMatch(/[\u202A-\u202E]/);
    expect(Array.from(name)).toHaveLength(60);
  });

  test("delivery falls back to the account name without a profile display name", async () => {
    const { delivered } = await follow({ name: "Clerk Name" });
    expect(delivered?.params.actorName).toBe("Clerk Name");
  });

  test("never stores or delivers the email when the member has no name", async () => {
    const { rows, delivered } = await follow({});
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("follower@example.com");
    expect(delivered?.params.actorName).toBeUndefined();
    expect(JSON.stringify(delivered)).not.toContain("follower@example.com");
  });
});

// Rows written before SEC-68 still carry the snapshot. The migration strips it from every row that
// names its actor by ref (nothing visible changes: email, push and the bell resolve the ref). A row
// without refs shows only its snapshot, so stripping it (includeUnattributed) is opt-in.
describe("stripActorNameSnapshots", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const T = 1_700_000_000_000;

  const seed = async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const mk = (clerkId: string) =>
        ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.com`,
          isActive: true,
          createdAt: T,
          updatedAt: T,
        });
      const viewer = await mk("viewer");
      const mara = await mk("mara");
      const row = (
        params: Record<string, string> | undefined,
        actorIds?: Id<"users">[],
      ) =>
        ctx.db.insert("notifications", {
          userId: viewer,
          type: "trade_request",
          ...(params !== undefined ? { params } : {}),
          ...(actorIds !== undefined
            ? { actorIds, actorCount: actorIds.length }
            : {}),
          isRead: false,
          createdAt: T,
        });
      return {
        viewer,
        mara,
        withContext: await row(
          { actorName: "Mara", puzzleTitle: "Starry Night" },
          [mara],
        ),
        nameOnly: await row({ actorName: "Mara" }, [mara]),
        unattributed: await row({ actorName: "Old Name" }),
        noName: await row({ puzzleTitle: "Starry Night" }, [mara]),
      };
    });
    return { t, ...ids };
  };

  type Seeded = Awaited<ReturnType<typeof seed>>;

  const paramsOf = (s: Seeded) =>
    s.t.run(async (ctx) => ({
      withContext: (await ctx.db.get(s.withContext))?.params,
      nameOnly: (await ctx.db.get(s.nameOnly))?.params,
      unattributed: (await ctx.db.get(s.unattributed))?.params,
      noName: (await ctx.db.get(s.noName))?.params,
    }));

  const before = {
    withContext: { actorName: "Mara", puzzleTitle: "Starry Night" },
    nameOnly: { actorName: "Mara" },
    unattributed: { actorName: "Old Name" },
    noName: { puzzleTitle: "Starry Night" },
  };

  test("is a dry run by default: counts, writes nothing", async () => {
    const s = await seed();
    const counts = await s.t.mutation(
      internal.notifications.backfill.stripActorNameSnapshots,
      {},
    );
    expect(counts).toEqual({ scanned: 4, stripped: 2, keptUnattributed: 1 });
    expect(await paramsOf(s)).toEqual(before);
  });

  test("strips the snapshot from rows with actor refs and keeps their other params", async () => {
    const s = await seed();
    await s.t.mutation(
      internal.notifications.backfill.stripActorNameSnapshots,
      { dryRun: false },
    );
    expect(await paramsOf(s)).toEqual({
      withContext: { puzzleTitle: "Starry Night" },
      nameOnly: undefined,
      unattributed: { actorName: "Old Name" },
      noName: { puzzleTitle: "Starry Night" },
    });
  });

  test("includeUnattributed strips ref-less rows too", async () => {
    const s = await seed();
    const counts = await s.t.mutation(
      internal.notifications.backfill.stripActorNameSnapshots,
      { dryRun: false, includeUnattributed: true },
    );
    expect(counts).toEqual({ scanned: 4, stripped: 3, keptUnattributed: 0 });
    expect((await paramsOf(s)).unattributed).toBeUndefined();
  });

  test("pages through the table and is idempotent", async () => {
    vi.useFakeTimers();
    const s = await seed();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < STRIP_ACTOR_NAMES_BATCH + 3; i++) {
        await ctx.db.insert("notifications", {
          userId: s.viewer,
          type: "new_follower",
          params: { actorName: `Follower ${i}` },
          actorIds: [s.mara],
          actorCount: 1,
          isRead: false,
          createdAt: T,
        });
      }
    });
    await s.t.mutation(
      internal.notifications.backfill.stripActorNameSnapshots,
      { dryRun: false },
    );
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const named = await s.t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter(
        (row) => row.params?.actorName !== undefined,
      ),
    );
    expect(named.map((row) => row._id)).toEqual([s.unattributed]);
    const again = await s.t.mutation(
      internal.notifications.backfill.stripActorNameSnapshots,
      { dryRun: false },
    );
    expect(again.stripped).toBe(0);
  });
});
