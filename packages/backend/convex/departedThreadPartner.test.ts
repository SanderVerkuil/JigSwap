import { toMemberId } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { makeNotify } from "./notifications/adapters/makeNotify";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";

// A DM or exchange thread whose other participant has left (their users row deleted by
// users.deleteUser, or deactivated by a CSAM tombstone) can't take replies (SEC-79). Account
// deletion keeps the departed id in a DM or exchange thread's participants, so without this a
// post would notify the purged id and recreate its notification and preference rows. Posting is
// refused with the generic CannotReply, the inbox row says readOnly up front, and no
// notification ever reaches a recipient who is not an active member (the subscriber and
// makeNotify both refuse them). A circle thread is shared context and keeps taking posts while
// some member is gone.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Departure = "deleted" | "deactivated";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    // Alice and Bob follow each other, so either may open a DM.
    for (const [followerId, followeeId] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      await ctx.db.insert("follows", {
        aggregateId: crypto.randomUUID(),
        followerId,
        followeeId,
        createdAt: now,
      });
    }
    return { alice, bob, carol };
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });
const asAlice = (t: T) => as(t, "clerk_alice");

// What users.deleteUser leaves behind: no row at all, or an inactive tombstone.
const depart = (t: T, member: Id<"users">, how: Departure) =>
  t.run(async (ctx) => {
    if (how === "deleted") await ctx.db.delete(member);
    else await ctx.db.patch(member, { isActive: false });
  });

const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

const post = (t: T, clerkId: string, threadId: string, body = "hi") =>
  as(t, clerkId).mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body,
  });

const openDm = (t: T, recipientId: Id<"users">) =>
  asAlice(t).mutation(api.conversation.openDmThread.openDmThread, {
    recipientId,
  });

// Bob sells a copy to Alice; accepting opens their exchange thread.
const openExchangeThread = async (t: T, bob: Id<"users">) => {
  const copyId = await t.run(async (ctx) => {
    const now = Date.now();
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
  });
  const exchangeId = await asAlice(t).mutation(api.exchange.propose.propose, {
    recipientId: bob,
    type: "sale",
    requestedPuzzleId: copyId,
    salePrice: 10,
  });
  await as(t, "clerk_bob").mutation(api.exchange.accept.accept, {
    exchangeId,
  });
  await flush(t);
  const threadId = await asAlice(t).query(
    api.conversation.getThreadByExchange.getThreadByExchange,
    { exchangeId },
  );
  expect(threadId).not.toBeNull();
  return threadId!;
};

const notificationRowsOf = (t: T, member: Id<"users">) =>
  t.run(async (ctx) => ({
    notifications: await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", member))
      .collect(),
    preferences: await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) => q.eq("memberId", member))
      .collect(),
  }));

const inboxRow = async (t: T, threadId: string) =>
  (await asAlice(t).query(api.conversation.getMyInbox.getMyInbox, {})).find(
    (row) => row.threadId === threadId,
  );

describe.each(["deleted", "deactivated"] as const)(
  "the other participant was %s",
  (how) => {
    test("a DM refuses replies with CannotReply and reads as readOnly", async () => {
      const t = convexTest(schema, modules);
      const { bob } = await seed(t);
      const threadId = await openDm(t, bob);
      await post(t, "clerk_alice", threadId, "before");
      expect((await inboxRow(t, threadId))?.readOnly).toBeUndefined();

      await depart(t, bob, how);

      await expectCode(post(t, "clerk_alice", threadId), "CannotReply");
      // sendLocation shares the same gate (assertThreadNotBlocked).
      vi.stubEnv("MAPTILER_API_KEY", "test-key");
      await expectCode(
        asAlice(t).mutation(api.conversation.sendLocation.sendLocation, {
          threadId,
          lat: 52.09,
          lng: 5.12,
          source: "pin",
          precision: "exact",
        }),
        "CannotReply",
      );
      const row = await inboxRow(t, threadId);
      expect(row?.readOnly).toBe(true);
      expect(row?.blocked).toBeUndefined();
    });

    test("an exchange thread refuses replies with CannotReply and reads as readOnly", async () => {
      const t = convexTest(schema, modules);
      const { bob } = await seed(t);
      const threadId = await openExchangeThread(t, bob);
      expect((await inboxRow(t, threadId))?.readOnly).toBeUndefined();

      await depart(t, bob, how);

      await expectCode(post(t, "clerk_alice", threadId), "CannotReply");
      expect((await inboxRow(t, threadId))?.readOnly).toBe(true);
    });

    test("the subscriber delivers nothing to them and recreates no rows", async () => {
      const t = convexTest(schema, modules);
      const { alice, bob, carol } = await seed(t);
      await depart(t, bob, how);

      await t.run(async (ctx) => {
        // A message from Alice in the DM Bob still sits in, and Bob following Carol: Bob gets
        // nothing, Carol still hears about her new follower.
        await ctx.db.insert("threads", {
          aggregateId: "dm-thread",
          subjectKind: "dm",
          participants: [alice, bob],
          participantsKey: [alice, bob].sort().join("|"),
          readReceipts: [],
          createdAt: Date.now(),
        });
        for (const [name, payload] of [
          ["MessagePosted", { threadId: "dm-thread", authorId: alice }],
          ["MemberFollowed", { followerId: alice, followeeId: bob }],
          ["MemberFollowed", { followerId: bob, followeeId: carol }],
        ] as const) {
          const eventId = await ctx.db.insert("domainEvents", {
            name,
            payload,
            occurredAt: Date.now(),
            context: "test",
          });
          await handleDomainEvent(
            ctx,
            (await ctx.db.get(eventId)) as Doc<"domainEvents">,
          );
        }
      });

      expect(await notificationRowsOf(t, bob)).toEqual({
        notifications: [],
        preferences: [],
      });
      expect(
        (await notificationRowsOf(t, carol)).notifications.map(
          (row) => row.type,
        ),
      ).toEqual(["new_follower"]);
    });

    test("a notification sent outside the subscriber reaches them neither", async () => {
      const t = convexTest(schema, modules);
      const { bob, carol } = await seed(t);
      await depart(t, bob, how);

      // The direct makeNotify callers (admin decisions, message-photo rejections, the what's-new
      // fan-out) share the same refusal.
      await t.run(async (ctx) => {
        for (const member of [bob, carol]) {
          await makeNotify(ctx)({
            memberId: toMemberId(member),
            type: "whats_new",
            relatedId: "entry-1",
            subject: { kind: "whatsNew", entryId: "entry-1" },
          });
        }
      });

      expect(await notificationRowsOf(t, bob)).toEqual({
        notifications: [],
        preferences: [],
      });
      expect(
        (await notificationRowsOf(t, carol)).notifications.map(
          (row) => row.type,
        ),
      ).toEqual(["whats_new"]);
    });
  },
);

test("a circle thread keeps taking posts while one of its members is deactivated", async () => {
  const t = convexTest(schema, modules);
  const { bob, carol } = await seed(t);
  const circleId = (await asAlice(t).mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await asAlice(t).mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  await flush(t);
  const threadId = (await asAlice(t).mutation(
    api.conversation.openCircleThread.openCircleThread,
    { circleId },
  )) as string;

  await depart(t, bob, "deactivated");
  await depart(t, carol, "deactivated");

  await expect(post(t, "clerk_alice", threadId)).resolves.toEqual(
    expect.any(String),
  );
});
