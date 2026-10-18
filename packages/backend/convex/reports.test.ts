import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

// Reports (spec 2.5): filing (visibility per target kind, dedupe, evidence snapshot, the Art. 16(2)
// notice, the rate limit) and the admin queue and decision (gating, tombstone, photo removal,
// same-target fan-out, notifications without an actor, the audit stamp).

const THREAD = "thread-ab";

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    const ada = await mkUser("clerk_ada", "Ada Admin");

    // A DM between alice and bob: a system message, then 12 alternating text messages (m0..m11).
    await ctx.db.insert("threads", {
      aggregateId: THREAD,
      subjectKind: "dm",
      participants: [alice, bob],
      participantsKey: [alice, bob].sort().join("|"),
      readReceipts: [],
      lastMessageAt: 1000 + 11,
      createdAt: 1,
    });
    for (const memberId of [alice, bob]) {
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: THREAD,
        memberId,
      });
    }
    await ctx.db.insert("threadMessages", {
      threadAggregateId: THREAD,
      messageId: "sys",
      kind: "system",
      body: "Conversation started",
      sentAt: 999,
    });

    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (forTrade: boolean) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade, forSale: false, forLend: false },
        snapshot: { title: "Starry Night", pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
      });
    const openCopy = await mkCopy(true);
    const closedCopy = await mkCopy(false);

    for (let i = 0; i < 12; i++) {
      await ctx.db.insert("threadMessages", {
        threadAggregateId: THREAD,
        messageId: `m${i}`,
        authorId: i % 2 === 0 ? bob : alice,
        kind: "text",
        body: `message ${i}`,
        sentAt: 1000 + i,
        ...(i === 10 ? { copyId: openCopy } : {}),
      });
    }

    const mkPhoto = async (
      copyId: Id<"ownedPuzzles">,
      moderationStatus?: "pending" | "approved" | "rejected",
    ) => {
      const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
      return ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copyId,
        uploaderId: bob,
        fileId,
        ...(moderationStatus ? { moderationStatus } : {}),
        createdAt: now,
        updatedAt: now,
      });
    };
    const photo = await mkPhoto(openCopy, "approved");
    const pendingPhoto = await mkPhoto(openCopy, "pending");
    const closedPhoto = await mkPhoto(closedCopy);
    await ctx.db.patch(openCopy, { coverImageId: photo });

    const exchangeId = await ctx.db.insert("exchanges", {
      aggregateId: "exchange-ab",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: openCopy,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });

    return {
      alice,
      bob,
      carol,
      ada,
      openCopy,
      closedCopy,
      photo,
      pendingPhoto,
      closedPhoto,
      exchangeId,
    };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: T) => t.withIdentity({ subject: "clerk_carol" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } | string => {
  const data = (e as ConvexError<Value>).data;
  if (typeof data !== "string") return data as { code?: string };
  try {
    return JSON.parse(data) as { code?: string };
  } catch {
    return data;
  }
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = dataOf(error);
  expect(typeof data === "string" ? data : data.code).toBe(code);
};

type FileArgs = {
  targetKind: "user" | "message" | "copy" | "photo" | "exchange";
  targetId: string;
  reason?:
    | "spam_scam"
    | "harassment_hate"
    | "sexual"
    | "fake_trade"
    | "illegal"
    | "other";
  details?: string;
  illegalNotice?: {
    notifierName?: string;
    notifierEmail?: string;
    goodFaith: boolean;
  };
};

const file = (as: ReturnType<typeof asAlice>, args: FileArgs) =>
  as.mutation(api.reports.fileReport.fileReport, {
    reason: "harassment_hate",
    ...args,
  });

const reportRow = (t: T, id: Id<"reports">) =>
  t.run(async (ctx) => (await ctx.db.get(id))!);

const notificationsOf = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

describe("fileReport: target visibility", () => {
  test("message: a participant reports the other person's message; the author is reported", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    const row = await reportRow(t, reportId);
    expect(row).toMatchObject({
      targetKind: "message",
      targetId: "m10",
      reportedUserId: bob,
      status: "open",
    });
  });

  test("message: a non-participant, an unknown id, your own message and a system message are NotFound", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expectCode(
      file(asCarol(t), { targetKind: "message", targetId: "m10" }),
      "NotFound",
    );
    await expectCode(
      file(asAlice(t), { targetKind: "message", targetId: "nope" }),
      "NotFound",
    );
    await expectCode(
      file(asAlice(t), { targetKind: "message", targetId: "m11" }),
      "NotFound",
    );
    await expectCode(
      file(asAlice(t), { targetKind: "message", targetId: "sys" }),
      "NotFound",
    );
  });

  test("user: a member the reporter can see: a public profile, mutual followers, a shared thread or exchange", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol } = await seed(t);
    const dave = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("users", {
        clerkId: "clerk_dave",
        email: "dave@example.com",
        name: "Dave",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      // carol and dave are private from here on.
      for (const memberId of [carol, id]) {
        await ctx.db.insert("profiles", {
          memberId,
          visibility: "private",
          updatedAt: now,
        });
      }
      return id;
    });
    const asDave = t.withIdentity({ subject: "clerk_dave" });

    // Private and unrelated: not visible, so NotFound.
    await expectCode(
      file(asAlice(t), { targetKind: "user", targetId: carol }),
      "NotFound",
    );
    // Mutual followers.
    await t.run(async (ctx) => {
      for (const [followerId, followeeId] of [
        [alice, carol],
        [carol, alice],
      ] as const) {
        await ctx.db.insert("follows", {
          aggregateId: crypto.randomUUID(),
          followerId,
          followeeId,
          createdAt: Date.now(),
        });
      }
    });
    await file(asAlice(t), { targetKind: "user", targetId: carol });

    // A shared exchange (no thread yet), from either side.
    await expectCode(
      file(asDave, { targetKind: "user", targetId: carol }),
      "NotFound",
    );
    await t.run(async (ctx) => {
      const copy = await ctx.db.query("ownedPuzzles").first();
      await ctx.db.insert("exchanges", {
        aggregateId: "exchange-cd",
        initiatorId: carol,
        recipientId: dave,
        type: "trade",
        requestedPuzzleId: copy!._id,
        status: "proposed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await file(asDave, { targetKind: "user", targetId: carol });
    await file(asCarol(t), { targetKind: "user", targetId: dave });
  });

  test("user: a private member who blocked the reporter is still reportable over a shared thread", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        memberId: bob,
        visibility: "private",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: alice,
        createdAt: Date.now(),
      });
    });
    // alice and bob share THREAD (and an exchange).
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    expect((await reportRow(t, reportId)).reportedUserId).toBe(bob);
    // The blocker can report back too.
    await file(asBob(t), { targetKind: "user", targetId: alice });
  });

  test("user: any other existing member, also after a block; never yourself", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: alice,
        createdAt: Date.now(),
      }),
    );
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    expect((await reportRow(t, reportId)).reportedUserId).toBe(bob);
    await file(asAlice(t), { targetKind: "user", targetId: carol });
    await expectCode(
      file(asAlice(t), { targetKind: "user", targetId: alice }),
      "NotFound",
    );
    await expectCode(
      file(asAlice(t), { targetKind: "user", targetId: "not-an-id" }),
      "NotFound",
    );
  });

  test("copy: viewable copies only; the owner is reported", async () => {
    const t = convexTest(schema, modules);
    const { bob, openCopy, closedCopy } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "copy",
      targetId: openCopy,
    });
    expect((await reportRow(t, reportId)).reportedUserId).toBe(bob);
    await expectCode(
      file(asAlice(t), { targetKind: "copy", targetId: closedCopy }),
      "NotFound",
    );
    // Your own copy.
    await expectCode(
      file(asBob(t), { targetKind: "copy", targetId: openCopy }),
      "NotFound",
    );
  });

  test("photo: an approved photo on a viewable copy; pending or on a hidden copy is NotFound", async () => {
    const t = convexTest(schema, modules);
    const { bob, photo, pendingPhoto, closedPhoto } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "photo",
      targetId: photo,
    });
    expect((await reportRow(t, reportId)).reportedUserId).toBe(bob);
    await expectCode(
      file(asAlice(t), { targetKind: "photo", targetId: pendingPhoto }),
      "NotFound",
    );
    await expectCode(
      file(asAlice(t), { targetKind: "photo", targetId: closedPhoto }),
      "NotFound",
    );
  });

  test("exchange: a party reports the other party, by aggregateId or raw _id; outsiders are NotFound", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, exchangeId } = await seed(t);
    const first = await file(asAlice(t), {
      targetKind: "exchange",
      targetId: "exchange-ab",
    });
    const row = await reportRow(t, first.reportId);
    expect(row).toMatchObject({
      targetId: "exchange-ab",
      reportedUserId: bob,
    });
    const fromBob = await file(asBob(t), {
      targetKind: "exchange",
      targetId: exchangeId,
    });
    // The raw _id resolves to the canonical aggregateId.
    expect(await reportRow(t, fromBob.reportId)).toMatchObject({
      targetId: "exchange-ab",
      reportedUserId: alice,
    });
    await expectCode(
      file(asCarol(t), { targetKind: "exchange", targetId: "exchange-ab" }),
      "NotFound",
    );
  });
});

describe("fileReport: rules", () => {
  test("one open report per reporter and target: a repeat returns the same id, unchanged", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const first = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
      details: "first",
    });
    const again = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
      reason: "spam_scam",
      details: "second",
    });
    expect(again.reportId).toBe(first.reportId);
    expect(await reportRow(t, first.reportId)).toMatchObject({
      reason: "harassment_hate",
      details: "first",
    });
    const count = await t.run(
      async (ctx) => (await ctx.db.query("reports").collect()).length,
    );
    expect(count).toBe(1);
  });

  test("the evidence is the target plus up to 10 preceding messages, and survives edits and removal", async () => {
    const t = convexTest(schema, modules);
    const { bob, openCopy } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    const before = (await reportRow(t, reportId)).evidence.messages!;
    // m0..m9 precede m10 (the system message falls outside the 10-message window).
    expect(before.map((m) => m.messageId)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
    ]);
    expect(before[before.length - 1]).toMatchObject({
      authorId: bob,
      kind: "text",
      body: "message 10",
      sentAt: 1010,
      copyId: openCopy,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", "m10"))
        .first();
      await ctx.db.patch(row!._id, { body: "edited", removedAt: Date.now() });
    });
    expect((await reportRow(t, reportId)).evidence.messages).toEqual(before);
  });

  test("an already-removed neighbour is snapshotted as removed, with an empty body and no copy", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const first = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: first.reportId,
      decision: "content_removed",
      statementOfReasons: "Harassing language",
    });
    // A legacy tombstone (before bodies were cleared) still has its body on the row.
    await t.run(async (ctx) => {
      const m8 = await ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", "m8"))
        .first();
      await ctx.db.patch(m8!._id, { removedAt: Date.now() });
    });

    const { reportId } = await file(asBob(t), {
      targetKind: "message",
      targetId: "m11",
    });
    const messages = (await reportRow(t, reportId)).evidence.messages!;
    for (const id of ["m8", "m10"]) {
      const snapshot = messages.find((m) => m.messageId === id)!;
      expect(snapshot).toMatchObject({ body: "", removed: true });
      expect(snapshot).not.toHaveProperty("copyId");
    }
    expect(messages.find((m) => m.messageId === "m9")).toEqual({
      messageId: "m9",
      authorId: alice,
      kind: "text",
      body: "message 9",
      sentAt: 1009,
    });
    expect(messages[messages.length - 1]).toMatchObject({
      messageId: "m11",
      authorId: alice,
      body: "message 11",
    });
  });

  test("a non-message target carries no message evidence", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    expect((await reportRow(t, reportId)).evidence).toEqual({});
  });

  test("details over 1000 characters are refused", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expectCode(
      file(asAlice(t), {
        targetKind: "user",
        targetId: bob,
        details: "x".repeat(1001),
      }),
      "DetailsTooLong",
    );
  });

  test("illegal: the good-faith statement is required; name and email are prefilled from the account", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expectCode(
      file(asAlice(t), {
        targetKind: "user",
        targetId: bob,
        reason: "illegal",
      }),
      "IllegalNoticeRequired",
    );
    await expectCode(
      file(asAlice(t), {
        targetKind: "user",
        targetId: bob,
        reason: "illegal",
        illegalNotice: { goodFaith: false },
      }),
      "IllegalNoticeRequired",
    );
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
      reason: "illegal",
      illegalNotice: { goodFaith: true, notifierName: "  A. Liddell " },
    });
    // The email equals the account's, so it isn't copied onto the notice.
    expect((await reportRow(t, reportId)).illegalNotice).toEqual({
      notifierName: "A. Liddell",
      goodFaith: true,
    });
  });

  test("illegal: a differing email is stored; getReport falls back to the account email", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol } = await seed(t);
    const own = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
      reason: "illegal",
      illegalNotice: {
        goodFaith: true,
        notifierEmail: " CLERK_ALICE@example.com ",
      },
    });
    const other = await file(asAlice(t), {
      targetKind: "user",
      targetId: carol,
      reason: "illegal",
      illegalNotice: { goodFaith: true, notifierEmail: "legal@firm.example" },
    });
    expect((await reportRow(t, own.reportId)).illegalNotice).toEqual({
      notifierName: "Alice",
      goodFaith: true,
    });
    expect((await reportRow(t, other.reportId)).illegalNotice).toEqual({
      notifierName: "Alice",
      notifierEmail: "legal@firm.example",
      goodFaith: true,
    });

    const detail = (reportId: Id<"reports">) =>
      asAdmin(t).query(api.admin.getReport.getReport, { reportId });
    expect((await detail(own.reportId)).illegalNotice).toEqual({
      notifierName: "Alice",
      notifierEmail: "clerk_alice@example.com",
      goodFaith: true,
    });
    expect((await detail(other.reportId)).illegalNotice).toMatchObject({
      notifierEmail: "legal@firm.example",
    });
  });

  test("illegal: an over-long name or email, or a malformed email, is IllegalNoticeIncomplete", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    for (const notice of [
      { notifierName: "x".repeat(201) },
      { notifierEmail: `${"x".repeat(243)}@example.com` },
      { notifierEmail: "not-an-email" },
      { notifierEmail: "two words@example.com" },
    ]) {
      await expectCode(
        file(asAlice(t), {
          targetKind: "user",
          targetId: bob,
          reason: "illegal",
          illegalNotice: { goodFaith: true, ...notice },
        }),
        "IllegalNoticeIncomplete",
      );
    }
    // At the limits it is accepted.
    await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
      reason: "illegal",
      illegalNotice: {
        goodFaith: true,
        notifierName: "x".repeat(200),
        notifierEmail: `${"x".repeat(242)}@example.com`,
      },
    });
  });

  test("illegal: refused when neither the client nor the account has an email", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run((ctx) => ctx.db.patch(alice, { email: undefined }));
    await expectCode(
      file(asAlice(t), {
        targetKind: "user",
        targetId: bob,
        reason: "illegal",
        illegalNotice: { goodFaith: true },
      }),
      "IllegalNoticeIncomplete",
    );
  });

  test("a notice on a non-illegal reason is not stored", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
      reason: "spam_scam",
      illegalNotice: { goodFaith: true },
    });
    expect((await reportRow(t, reportId)).illegalNotice).toBeUndefined();
  });

  test(`rate-limited at ${RATE_LIMITS.reportFile.max} per day`, async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    for (let i = 0; i < RATE_LIMITS.reportFile.max; i++) {
      await file(asAlice(t), { targetKind: "user", targetId: bob });
    }
    await expectCode(
      file(asAlice(t), { targetKind: "user", targetId: bob }),
      "RateLimited",
    );
  });

  test("unauthenticated callers are refused", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expectCode(
      t.mutation(api.reports.fileReport.fileReport, {
        targetKind: "user",
        targetId: bob,
        reason: "other",
      }),
      "Unauthenticated",
    );
  });

  test("filing removes nothing", async () => {
    const t = convexTest(schema, modules);
    const { photo } = await seed(t);
    await file(asAlice(t), { targetKind: "photo", targetId: photo });
    await file(asAlice(t), { targetKind: "message", targetId: "m10" });
    const messages = await asAlice(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId: THREAD },
    );
    expect(messages.find((m) => m.id === "m10")).toMatchObject({
      body: "message 10",
    });
    expect(await t.run((ctx) => ctx.db.get(photo))).not.toBeNull();
  });
});

describe("listMyReports", () => {
  test("returns only the caller's reports, newest first, with status and decision", async () => {
    const t = convexTest(schema, modules);
    const { bob, alice } = await seed(t);
    const older = await file(asAlice(t), { targetKind: "user", targetId: bob });
    await new Promise((resolve) => setTimeout(resolve, 3));
    const newer = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    await file(asBob(t), { targetKind: "user", targetId: alice });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: older.reportId,
      decision: "warned",
      statementOfReasons: "Insults in chat",
    });

    const mine = await asAlice(t).query(
      api.reports.listMyReports.listMyReports,
      {},
    );
    expect(mine.map((r) => r.reportId)).toEqual([
      newer.reportId,
      older.reportId,
    ]);
    expect(mine[0]).toMatchObject({ status: "open" });
    expect(mine[0]).not.toHaveProperty("decision");
    expect(mine[1]).toMatchObject({ status: "actioned", decision: "warned" });
    expect(mine[1]).not.toHaveProperty("statementOfReasons");
  });
});

describe("admin report functions: gating", () => {
  test("a non-admin gets Forbidden from every admin report function", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    await expectCode(
      asAlice(t).query(api.admin.listReports.listReports, {
        status: "open",
        paginationOpts: { numItems: 10, cursor: null },
      }),
      "Forbidden",
    );
    await expectCode(
      asAlice(t).query(api.admin.getReport.getReport, { reportId }),
      "Forbidden",
    );
    await expectCode(
      asAlice(t).mutation(api.admin.decideReport.decideReport, {
        reportId,
        decision: "dismissed",
        statementOfReasons: "No violation",
      }),
      "Forbidden",
    );
    expect((await reportRow(t, reportId)).status).toBe("open");
  });
});

describe("admin listReports / getReport", () => {
  test("lists by status newest first with labels, summary and the open count against the member", async () => {
    const t = convexTest(schema, modules);
    const { bob, openCopy } = await seed(t);
    await file(asAlice(t), { targetKind: "copy", targetId: openCopy });
    await new Promise((resolve) => setTimeout(resolve, 3));
    await file(asAlice(t), { targetKind: "message", targetId: "m10" });

    const result = await asAdmin(t).query(api.admin.listReports.listReports, {
      status: "open",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page.map((r) => r.targetKind)).toEqual(["message", "copy"]);
    expect(result.page[0]).toMatchObject({
      reporterLabel: "Alice",
      reportedUserId: bob,
      reportedLabel: "Bob",
      reason: "harassment_hate",
      targetSummary: "message 10",
      openReportsAgainstReported: 2,
    });
    expect(result.page[1]).toMatchObject({ targetSummary: "Starry Night" });

    const decided = await asAdmin(t).query(api.admin.listReports.listReports, {
      status: "dismissed",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(decided.page).toHaveLength(0);
  });

  test("getReport carries the evidence, a photo URL while the photo exists, and the member's other reports", async () => {
    const t = convexTest(schema, modules);
    const { bob, photo } = await seed(t);
    const photoReport = await file(asAlice(t), {
      targetKind: "photo",
      targetId: photo,
      details: "inappropriate",
    });
    const messageReport = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: messageReport.reportId,
      decision: "warned",
      statementOfReasons: "Rude",
    });

    const detail = await asAdmin(t).query(api.admin.getReport.getReport, {
      reportId: photoReport.reportId,
    });
    expect(detail).toMatchObject({
      targetKind: "photo",
      details: "inappropriate",
      reportedUserId: bob,
      reportedLabel: "Bob",
      otherReportCount: 1,
      otherReports: [
        {
          reportId: messageReport.reportId,
          status: "actioned",
          decision: "warned",
        },
      ],
    });
    expect(typeof detail.photoUrl).toBe("string");

    const messageDetail = await asAdmin(t).query(
      api.admin.getReport.getReport,
      { reportId: messageReport.reportId },
    );
    expect(messageDetail.evidence.messages).toHaveLength(11);
    expect(messageDetail).toMatchObject({
      statementOfReasons: "Rude",
      decidedByLabel: "Ada Admin",
      photoUrl: null,
    });
  });
});

describe("admin decideReport", () => {
  test("content_removed on a message tombstones it in the thread and the inbox, and drops its copy card", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Make m10 the newest message so it is the inbox preview.
    await t.run(async (ctx) => {
      const m11 = await ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", "m11"))
        .first();
      await ctx.db.delete(m11!._id);
    });
    const { reportId } = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    const beforeView = await asAlice(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId: THREAD },
    );
    expect(beforeView.find((m) => m.id === "m10")?.copy).toBeDefined();

    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Harassing language",
    });

    for (const as of [asAlice(t), asBob(t)]) {
      const messages = await as.query(
        api.conversation.getThreadMessages.getThreadMessages,
        { threadId: THREAD },
      );
      const removed = messages.find((m) => m.id === "m10")!;
      expect(removed).toMatchObject({ body: "", removed: true });
      expect(removed.copy).toBeUndefined();
      expect(messages.find((m) => m.id === "m9")).not.toHaveProperty("removed");

      const inbox = await as.query(api.conversation.getMyInbox.getMyInbox, {});
      expect(inbox[0].lastMessage).toMatchObject({
        id: "m10",
        body: "",
        removed: true,
      });
    }
    const row = await t.run((ctx) =>
      ctx.db
        .query("threadMessages")
        .withIndex("by_message_id", (q) => q.eq("messageId", "m10"))
        .first(),
    );
    // The content itself is gone from the row; the report's evidence keeps the original.
    expect(row).toMatchObject({ body: "", removedReason: "harassment_hate" });
    expect(row).not.toHaveProperty("copyId");
    expect(typeof row!.removedAt).toBe("number");
    expect(
      (await reportRow(t, reportId)).evidence.messages!.slice(-1)[0],
    ).toMatchObject({ messageId: "m10", body: "message 10" });
    expect(await reportRow(t, reportId)).toMatchObject({
      status: "actioned",
      decision: "content_removed",
      statementOfReasons: "Harassing language",
    });
  });

  test("content_removed on a photo deletes the row and blob and clears the cover", async () => {
    const t = convexTest(schema, modules);
    const { photo, openCopy } = await seed(t);
    const fileId = (await t.run((ctx) => ctx.db.get(photo)))!.fileId;
    const { reportId } = await file(asAlice(t), {
      targetKind: "photo",
      targetId: photo,
      reason: "sexual",
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Nudity",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(photo)).toBeNull();
      expect(await ctx.storage.getUrl(fileId)).toBeNull();
      expect((await ctx.db.get(openCopy))?.coverImageId).toBeUndefined();
    });
    const detail = await asAdmin(t).query(api.admin.getReport.getReport, {
      reportId,
    });
    expect(detail.photoUrl).toBeNull();
  });

  test("content_removed is an InvalidDecision for user, copy and exchange targets", async () => {
    const t = convexTest(schema, modules);
    const { bob, openCopy } = await seed(t);
    for (const args of [
      { targetKind: "user", targetId: bob },
      { targetKind: "copy", targetId: openCopy },
      { targetKind: "exchange", targetId: "exchange-ab" },
    ] as const) {
      const { reportId } = await file(asAlice(t), args);
      await expectCode(
        asAdmin(t).mutation(api.admin.decideReport.decideReport, {
          reportId,
          decision: "content_removed",
          statementOfReasons: "Removed",
        }),
        "InvalidDecision",
      );
      expect((await reportRow(t, reportId)).status).toBe("open");
    }
  });

  test("other open reports on the same target are decided together; a second decide is refused", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol } = await seed(t);
    const fromAlice = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    const fromCarol = await file(asCarol(t), {
      targetKind: "user",
      targetId: bob,
      reason: "spam_scam",
    });
    const unrelated = await file(asAlice(t), {
      targetKind: "user",
      targetId: carol,
    });

    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: fromAlice.reportId,
      decision: "dismissed",
      statementOfReasons: "  No violation found  ",
    });
    for (const id of [fromAlice.reportId, fromCarol.reportId]) {
      expect(await reportRow(t, id)).toMatchObject({
        status: "dismissed",
        decision: "dismissed",
        statementOfReasons: "No violation found",
      });
    }
    expect((await reportRow(t, unrelated.reportId)).status).toBe("open");

    await expectCode(
      asAdmin(t).mutation(api.admin.decideReport.decideReport, {
        reportId: fromCarol.reportId,
        decision: "warned",
        statementOfReasons: "Again",
      }),
      "ReportAlreadyDecided",
    );

    // A decided report no longer blocks a fresh one on the same target.
    const fresh = await file(asAlice(t), { targetKind: "user", targetId: bob });
    expect(fresh.reportId).not.toBe(fromAlice.reportId);
  });

  test("the statement of reasons is required and at most 2000 characters", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    for (const statementOfReasons of ["", "   ", "x".repeat(2001)]) {
      await expectCode(
        asAdmin(t).mutation(api.admin.decideReport.decideReport, {
          reportId,
          decision: "warned",
          statementOfReasons,
        }),
        "InvalidStatementOfReasons",
      );
    }
    expect((await reportRow(t, reportId)).status).toBe("open");
  });

  test("notifies every reporter and the reported member, never naming the moderator", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "message",
      targetId: "m10",
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Harassing language",
    });

    const toAlice = await notificationsOf(t, alice);
    expect(toAlice).toHaveLength(1);
    expect(toAlice[0]).toMatchObject({
      type: "report_decided",
      params: { decision: "content_removed" },
    });
    const toBob = await notificationsOf(t, bob);
    expect(toBob).toHaveLength(1);
    expect(toBob[0]).toMatchObject({
      type: "content_removed",
      params: {
        restricted: "message",
        ground: "harassment_hate",
        reason: "Harassing language",
        automated: "false",
        redress: "Reply via the contact page to request a review",
      },
    });
    for (const row of [...toAlice, ...toBob]) {
      expect(row.actorIds).toBeUndefined();
      expect(row.subject).toBeUndefined();
    }

    // The read model surfaces the outcome without an actor or a link.
    const views = await asBob(t).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(views.page[0]).toMatchObject({
      type: "content_removed",
      actors: [],
      href: null,
      context: {
        restrictedContent: "message",
        ground: "harassment_hate",
        reason: "Harassing language",
      },
    });
    const aliceViews = await asAlice(t).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(aliceViews.page[0]).toMatchObject({
      type: "report_decided",
      actors: [],
      context: { reportDecision: "content_removed" },
    });
  });

  test("warned sends member_warned; dismissed tells only the reporter", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol } = await seed(t);
    const warned = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: warned.reportId,
      decision: "warned",
      statementOfReasons: "Repeated insults",
    });
    const toBob = await notificationsOf(t, bob);
    expect(toBob).toHaveLength(1);
    expect(toBob[0]).toMatchObject({
      type: "member_warned",
      params: { ground: "harassment_hate", reason: "Repeated insults" },
    });
    expect(toBob[0].params).not.toHaveProperty("restricted");

    const dismissed = await file(asAlice(t), {
      targetKind: "user",
      targetId: carol,
    });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId: dismissed.reportId,
      decision: "dismissed",
      statementOfReasons: "No violation",
    });
    expect(await notificationsOf(t, carol)).toHaveLength(0);
    expect(
      (await notificationsOf(t, alice)).map((n) => n.params?.decision).sort(),
    ).toEqual(["dismissed", "warned"]);
  });

  test("stamps one moderationActions row with the admin as actor", async () => {
    const t = convexTest(schema, modules);
    const { ada, bob } = await seed(t);
    const { reportId } = await file(asAlice(t), {
      targetKind: "user",
      targetId: bob,
    });
    await file(asCarol(t), { targetKind: "user", targetId: bob });
    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "warned",
      statementOfReasons: "Rude",
    });
    const actions = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: ada,
      kind: "report_warned",
      targetLabel: "Bob",
      targetId: reportId,
    });
  });
});
