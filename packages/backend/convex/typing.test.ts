import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  TYPING_THROTTLE_MS,
  TYPING_TTL_MS,
} from "./conversation/typingIndicators";
import schema from "./schema";

// Typing indicators (G7, spec 4.3, 5.2): setTyping / clearTyping / getTyping. Every profile is
// PRIVATE; Alice and Bob follow each other (their DM), and the circle reveals its members to
// each other. Dave is in nothing.

// The presence override seam (TODO(G8)): stubbed so a test can make a member appear offline.
const offline = vi.hoisted(() => ({ members: new Set<string>() }));
vi.mock("./conversation/appearingOffline", () => ({
  isAppearingOffline: async (_ctx: unknown, memberId: string) =>
    offline.members.has(memberId),
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave";

beforeEach(() => {
  offline.members.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: clerkId,
      visibility: "private",
      updatedAt: now,
    });
    return id;
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: who });

const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data;
  return (typeof data === "string" ? JSON.parse(data) : data)?.code;
};

// Alice owns "Puzzle Club" with Bob and Carol; Alice and Bob also have a DM.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
  await t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 1,
    });
  });
  const dmId = (await as(t, "alice").mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: bob },
  )) as string;
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  await flush(t);
  const circleThreadId = (await as(t, "bob").mutation(
    api.conversation.openCircleThread.openCircleThread,
    { circleId },
  )) as string;
  return { alice, bob, carol, dave, dmId, circleId, circleThreadId };
};

const setTyping = (t: T, who: Who, threadId: string) =>
  as(t, who).mutation(api.conversation.setTyping.setTyping, { threadId });
const clearTyping = (t: T, who: Who, threadId: string) =>
  as(t, who).mutation(api.conversation.clearTyping.clearTyping, { threadId });
const getTyping = (t: T, who: Who, threadId: string) =>
  as(t, who).query(api.conversation.getTyping.getTyping, { threadId });

const typingRows = (t: T, threadId?: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("typingIndicators").collect()).filter(
      (row) => threadId === undefined || row.threadAggregateId === threadId,
    ),
  );

// Backdate a member's row, standing in for time passing.
const backdate = (
  t: T,
  threadId: string,
  memberId: Id<"users">,
  ageMs: number,
) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("typingIndicators")
      .withIndex("by_thread_member", (q) =>
        q.eq("threadAggregateId", threadId).eq("memberId", memberId),
      )
      .unique();
    if (!row) throw new Error("no typing row");
    const updatedAt = Date.now() - ageMs;
    await ctx.db.patch(row._id, { updatedAt });
    return updatedAt;
  });

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const typerNames = (views: Awaited<ReturnType<typeof getTyping>>) =>
  views.map((v) => (v.member.anonymous ? "anon" : v.member.member.name));

describe("setTyping / getTyping: who may", () => {
  test("a participant's typing shows to the others, with ageMs, never to themselves", async () => {
    const t = convexTest(schema, modules);
    const { alice, dmId } = await seed(t);

    expect(await setTyping(t, "alice", dmId)).toBeNull();

    const rows = await typingRows(t, dmId);
    expect(rows.map((r) => r.memberId)).toEqual([alice]);
    const seen = await getTyping(t, "bob", dmId);
    expect(typerNames(seen)).toEqual(["alice"]);
    expect(seen[0].ageMs).toBeGreaterThanOrEqual(0);
    expect(seen[0].ageMs).toBeLessThan(TYPING_TTL_MS);
    expect(await getTyping(t, "alice", dmId)).toEqual([]);
  });

  test("a non-participant gets the thread read's own generic errors, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { dmId, circleThreadId } = await seed(t);

    for (const threadId of [dmId, circleThreadId]) {
      expect(await codeOf(setTyping(t, "dave", threadId))).toBe(
        "NotParticipant",
      );
      expect(await codeOf(getTyping(t, "dave", threadId))).toBe(
        "NotParticipant",
      );
      // The same answer the message read gives, so typing is no new probe.
      expect(
        await codeOf(
          as(t, "dave").query(
            api.conversation.getThreadMessages.getThreadMessages,
            { threadId },
          ),
        ),
      ).toBe("NotParticipant");
    }
    expect(await codeOf(setTyping(t, "dave", "no-such-thread"))).toBe(
      "ThreadNotFound",
    );
    expect(await codeOf(getTyping(t, "dave", "no-such-thread"))).toBe(
      "ThreadNotFound",
    );
    expect(await typingRows(t)).toEqual([]);
  });

  test("a circle ex-member is refused at once, before the participant sync runs", async () => {
    const t = convexTest(schema, modules);
    const { circleId, circleThreadId } = await seed(t);

    await as(t, "carol").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    // No flush: the thread's participant set still lists Carol.
    expect(await codeOf(setTyping(t, "carol", circleThreadId))).toBe(
      "NotParticipant",
    );
    expect(await codeOf(getTyping(t, "carol", circleThreadId))).toBe(
      "NotParticipant",
    );
    expect(await typingRows(t, circleThreadId)).toEqual([]);
  });

  test("unauthenticated callers are refused", async () => {
    const t = convexTest(schema, modules);
    const { dmId } = await seed(t);
    await expect(
      t.mutation(api.conversation.setTyping.setTyping, { threadId: dmId }),
    ).rejects.toThrow();
    await expect(
      t.query(api.conversation.getTyping.getTyping, { threadId: dmId }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.conversation.clearTyping.clearTyping, { threadId: dmId }),
    ).rejects.toThrow();
  });
});

describe("setTyping: silent no-ops", () => {
  test("within the 2 s throttle nothing is written; after it the row is refreshed in place", async () => {
    const t = convexTest(schema, modules);
    const { alice, dmId } = await seed(t);
    await setTyping(t, "alice", dmId);

    const recent = await backdate(t, dmId, alice, TYPING_THROTTLE_MS - 500);
    expect(await setTyping(t, "alice", dmId)).toBeNull();
    expect((await typingRows(t, dmId)).map((r) => r.updatedAt)).toEqual([
      recent,
    ]);

    const old = await backdate(t, dmId, alice, TYPING_THROTTLE_MS + 500);
    await setTyping(t, "alice", dmId);
    const rows = await typingRows(t, dmId);
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedAt).toBeGreaterThan(old);
  });

  test("a DM pair blocked either way: no row, and an earlier row stays hidden", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, dmId } = await seed(t);
    await setTyping(t, "alice", dmId); // before the block

    await block(t, bob, alice);
    await backdate(t, dmId, alice, TYPING_THROTTLE_MS + 500);
    for (const who of ["alice", "bob"] as const) {
      expect(await setTyping(t, who, dmId)).toBeNull();
    }
    // Alice's row was not refreshed and Bob wrote none.
    const rows = await typingRows(t, dmId);
    expect(rows.map((r) => r.memberId)).toEqual([alice]);
    expect(rows[0].updatedAt).toBeLessThan(Date.now() - TYPING_THROTTLE_MS);
    expect(await getTyping(t, "bob", dmId)).toEqual([]);
  });

  test("a member appearing offline emits nothing", async () => {
    const t = convexTest(schema, modules);
    const { alice, dmId, circleThreadId } = await seed(t);
    offline.members.add(alice);

    expect(await setTyping(t, "alice", dmId)).toBeNull();
    expect(await setTyping(t, "alice", circleThreadId)).toBeNull();
    expect(await typingRows(t)).toEqual([]);
  });
});

describe("getTyping", () => {
  test("in a circle, a blocked pair never sees each other type; everyone else sees both", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleThreadId } = await seed(t);
    await block(t, alice, carol);

    // A block removes nobody from the circle: both still write.
    await setTyping(t, "alice", circleThreadId);
    await setTyping(t, "carol", circleThreadId);
    expect(await typingRows(t, circleThreadId)).toHaveLength(2);

    expect(typerNames(await getTyping(t, "alice", circleThreadId))).toEqual([]);
    expect(typerNames(await getTyping(t, "carol", circleThreadId))).toEqual([]);
    expect(
      typerNames(await getTyping(t, "bob", circleThreadId)).sort(),
    ).toEqual(["alice", "carol"]);
  });

  test("ageMs is measured from the row; a row 6 s old has expired", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleThreadId } = await seed(t);
    await setTyping(t, "alice", circleThreadId);
    await setTyping(t, "carol", circleThreadId);

    await backdate(t, circleThreadId, alice, 4_000);
    await backdate(t, circleThreadId, carol, TYPING_TTL_MS);
    const seen = await getTyping(t, "bob", circleThreadId);
    expect(typerNames(seen)).toEqual(["alice"]);
    expect(seen[0].ageMs).toBeGreaterThanOrEqual(4_000);
    expect(seen[0].ageMs).toBeLessThan(TYPING_TTL_MS);
  });
});

describe("clearing", () => {
  test("clearTyping deletes only the caller's own row; a stranger's call touches nothing", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleThreadId } = await seed(t);
    await setTyping(t, "alice", circleThreadId);
    await setTyping(t, "bob", circleThreadId);

    expect(await clearTyping(t, "alice", circleThreadId)).toBeNull();
    expect(await clearTyping(t, "dave", circleThreadId)).toBeNull();
    expect(
      (await typingRows(t, circleThreadId)).map((r) => r.memberId),
    ).toEqual([bob]);
  });

  test("posting a message clears the author's row in the same transaction", async () => {
    const t = convexTest(schema, modules);
    const { bob, dmId } = await seed(t);
    await setTyping(t, "alice", dmId);
    await setTyping(t, "bob", dmId);

    await as(t, "alice").mutation(api.conversation.postMessage.postMessage, {
      threadId: dmId,
      kind: "text",
      body: "Hi Bob",
    });
    expect((await typingRows(t, dmId)).map((r) => r.memberId)).toEqual([bob]);
    expect(await getTyping(t, "bob", dmId)).toEqual([]);
  });

  test("sharing a location clears the sender's row too (they typed its caption)", async () => {
    const t = convexTest(schema, modules);
    const { dmId } = await seed(t);
    vi.stubEnv("MAPTILER_API_KEY", "test-key");
    await setTyping(t, "alice", dmId);

    await as(t, "alice").mutation(api.conversation.sendLocation.sendLocation, {
      threadId: dmId,
      lat: 52.09,
      lng: 5.12,
      source: "pin",
      precision: "exact",
      caption: "Here",
    });
    expect(await typingRows(t, dmId)).toEqual([]);
  });
});

describe("the bandwidth wide event", () => {
  test("one sampled line per actual write, with no member or thread id", async () => {
    const t = convexTest(schema, modules);
    const { alice, dmId } = await seed(t);
    const log = vi.mocked(console.log);
    const typingLines = () =>
      log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('"conversation.setTyping"'));

    vi.spyOn(Math, "random").mockReturnValue(0);
    log.mockClear();
    await setTyping(t, "alice", dmId); // insert
    await setTyping(t, "alice", dmId); // throttled: no write, no line
    await backdate(t, dmId, alice, TYPING_THROTTLE_MS + 500);
    await setTyping(t, "alice", dmId); // patch
    const lines = typingLines().map((line) => JSON.parse(line));
    expect(lines.map((l) => [l.write, l.thread_kind, l.sample_rate])).toEqual([
      ["insert", "dm", 10],
      ["patch", "dm", 10],
    ]);
    for (const line of typingLines()) {
      expect(line).not.toContain(alice);
      expect(line).not.toContain(dmId);
    }

    // Unsampled writes log nothing.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    log.mockClear();
    await backdate(t, dmId, alice, TYPING_THROTTLE_MS + 500);
    await setTyping(t, "alice", dmId);
    expect(typingLines()).toEqual([]);
  });
});
