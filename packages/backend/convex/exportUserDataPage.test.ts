import {
  EXPORT_SECTIONS,
  type ExportPageView,
  type ExportRow,
  type ExportSection,
} from "@jigswap/contracts";
import { COOLDOWN_MS } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { EXPORT_PAGE_SIZE } from "./insights/exportUserDataPage";
import schema from "./schema";

// SEC-66: the member's data export is read section by section and page by page. Every section
// holds only the caller's own rows, every section pages to completion, other members appear only
// as the app shows them, and no row carries a raw _storage id.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob";
// The ctx t.run hands its callback: a mutation's, with an action's storage (blobs can be stored).
type SeedCtx = MutationCtx & Pick<ActionCtx, "storage">;

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

const exportSection = async (t: T, who: Who, section: ExportSection) => {
  const rows: ExportRow[] = [];
  let pages = 0;
  let cursor: string | null = null;
  for (;;) {
    const page: ExportPageView = await as(t, who).query(
      api.insights.exportUserDataPage.exportUserDataPage,
      { section, cursor },
    );
    rows.push(...page.rows);
    pages += 1;
    if (page.isDone) return { rows, pages };
    cursor = page.continueCursor;
  }
};

const exportAll = async (t: T, who: Who) => {
  const out: Partial<Record<ExportSection, ExportRow[]>> = {};
  for (const section of EXPORT_SECTIONS) {
    out[section] = (await exportSection(t, who, section)).rows;
  }
  return out as Record<ExportSection, ExportRow[]>;
};

const insertUser = (ctx: MutationCtx, who: string) =>
  ctx.db.insert("users", {
    clerkId: `clerk_${who}`,
    email: `${who}@example.com`,
    name: who[0]!.toUpperCase() + who.slice(1),
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

const blob = (ctx: SeedCtx, text: string) =>
  ctx.storage.store(new Blob([text], { type: "image/png" }));

// Every storage id the seed wrote for a member: none may appear in any export.
type Seeded = { me: Id<"users">; blobs: Id<"_storage">[] };

/**
 * One row (at least) in every exported table for `who`, against a counterpart member `other`
 * (and `blockee` for the block, so the follow lists stay visible). Free text the member wrote
 * carries `<who>-secret-…` so a leak into another member's export is visible.
 */
const seedMember = async (
  ctx: SeedCtx,
  who: Who,
  other: Id<"users">,
  blockee: Id<"users">,
): Promise<Seeded> => {
  const now = Date.now();
  const me = await insertUser(ctx, who);
  const secret = (field: string) => `${who}-secret-${field}`;
  const blobs: Id<"_storage">[] = [];
  const stored = async (text: string) => {
    const id = await blob(ctx, `${who}-${text}`);
    blobs.push(id);
    return id;
  };

  // account
  await ctx.db.insert("profiles", {
    memberId: me,
    displayName: secret("display-name"),
    bio: secret("bio"),
    visibility: "public",
    updatedAt: now,
  });
  await ctx.db.insert("solvingPreferences", {
    memberId: me,
    trackCompletionDuration: true,
    updatedAt: now,
  });
  await ctx.db.insert("presencePreferences", {
    memberId: me,
    share: true,
    override: "auto",
    updatedAt: now,
  });
  await ctx.db.insert("memberOnboarding", {
    memberId: me,
    skippedSteps: ["household"],
    updatedAt: now,
  });
  await ctx.db.insert("pushSubscriptions", {
    userId: me,
    endpoint: `https://push.example.com/${who}`,
    p256dh: secret("p256dh"),
    auth: secret("auth"),
    createdAt: now,
  });

  // library
  const boxArt = await stored("box-art");
  const puzzle = await ctx.db.insert("puzzles", {
    title: secret("submitted-title"),
    pieceCount: 1000,
    image: boxArt,
    status: "approved",
    submittedBy: me,
    createdAt: now,
    updatedAt: now,
  });
  const copy = await ctx.db.insert("ownedPuzzles", {
    puzzleId: puzzle,
    ownerId: me,
    snapshot: { title: "Snapshot", pieceCount: 1000, thumbnail: boxArt },
    condition: "good",
    notes: secret("copy-notes"),
    availability: { forTrade: true, forSale: false, forLend: false },
    createdAt: now,
    updatedAt: now,
  });
  const photo = await ctx.db.insert("ownedPuzzleImages", {
    ownedPuzzleId: copy,
    uploaderId: me,
    fileId: await stored("copy-photo"),
    description: secret("photo-description"),
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
  const collection = await ctx.db.insert("collections", {
    userId: me,
    name: secret("collection"),
    visibility: "private",
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("collectionMembers", {
    collectionId: collection,
    ownedPuzzleId: copy,
    addedAt: now,
  });
  await ctx.db.insert("categories", {
    userId: me,
    name: secret("category"),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("goals", {
    userId: me,
    title: secret("goal"),
    targetCompletions: 5,
    currentCompletions: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("favorites", {
    userId: me,
    puzzleId: puzzle,
    createdAt: now,
  });
  const solvePhoto = await stored("solve-photo");
  await ctx.db.insert("completions", {
    aggregateId: `completion-${who}`,
    userId: me,
    puzzleId: puzzle,
    ownedPuzzleId: copy,
    startDate: now - 1000,
    endDate: now,
    notes: secret("completion-notes"),
    photos: [solvePhoto],
    copySnapshot: {
      copyId: `copy-${who}`,
      ownerId: other,
      wasBorrowed: true,
      condition: "good",
    },
    isCompleted: true,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("completionImages", {
    completionId: `completion-${who}`,
    uploaderId: me,
    fileId: solvePhoto,
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("puzzleReviews", {
    userId: me,
    puzzleId: puzzle,
    rating: 4,
    text: secret("puzzle-review"),
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("copyReviews", {
    userId: me,
    copyId: copy,
    rating: 3,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("puzzleComments", {
    aggregateId: `comment-${who}`,
    puzzleId: puzzle,
    authorId: me,
    text: secret("puzzle-comment"),
    createdAt: now,
  });
  await ctx.db.insert("photoComments", {
    aggregateId: `photo-comment-${who}`,
    photoId: photo,
    authorId: me,
    text: secret("photo-comment"),
    createdAt: now,
  });
  await ctx.db.insert("puzzleChangeProposals", {
    aggregateId: `proposal-${who}`,
    puzzleDefinitionId: `definition-${who}`,
    proposedBy: me,
    status: "pending",
    changes: { image: await stored("proposed-box-art") },
    baseline: {},
    comment: secret("proposal-comment"),
    createdAt: now,
    updatedAt: now,
  });

  // exchanges, reviews and loans with the counterpart
  const otherCopy = await ctx.db.insert("ownedPuzzles", {
    puzzleId: puzzle,
    ownerId: other,
    condition: "good",
    availability: { forTrade: true, forSale: false, forLend: true },
    createdAt: now,
    updatedAt: now,
  });
  const proposed = await ctx.db.insert("exchanges", {
    initiatorId: me,
    recipientId: other,
    type: "trade",
    requestedPuzzleId: otherCopy,
    offeredPuzzleId: copy,
    status: "completed",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("tradeReveals", {
    exchangeId: proposed,
    reason: "accepted",
    revealedAt: now,
  });
  await ctx.db.insert("exchanges", {
    initiatorId: other,
    recipientId: me,
    type: "loan",
    requestedPuzzleId: copy,
    status: "completed",
    createdAt: now,
    updatedAt: now,
  });
  const categories = {
    communication: 5,
    packaging: 5,
    condition: 5,
    timeliness: 5,
  };
  await ctx.db.insert("reviews", {
    exchangeId: proposed,
    reviewerId: me,
    revieweeId: other,
    rating: 5,
    comment: secret("partner-review"),
    categories,
    createdAt: now,
  });
  await ctx.db.insert("reviews", {
    exchangeId: proposed,
    reviewerId: other,
    revieweeId: me,
    rating: 4,
    comment: "Smooth trade",
    categories,
    createdAt: now,
  });
  await ctx.db.insert("loans", {
    aggregateId: `loan-lent-${who}`,
    copyId: `copy-${who}`,
    lenderId: me,
    borrowerId: other,
    status: "open",
    openedAt: now,
  });
  await ctx.db.insert("loans", {
    aggregateId: `loan-borrowed-${who}`,
    copyId: `other-copy-${who}`,
    lenderId: other,
    borrowerId: me,
    status: "returned",
    openedAt: now,
    closedAt: now,
  });

  // social graph
  await ctx.db.insert("follows", {
    followerId: me,
    followeeId: other,
    createdAt: now,
  });
  await ctx.db.insert("follows", {
    followerId: other,
    followeeId: me,
    createdAt: now,
  });
  await ctx.db.insert("followRequests", {
    aggregateId: `request-out-${who}`,
    requesterId: me,
    targetId: other,
    status: "approved",
    createdAt: now,
    respondedAt: now,
  });
  await ctx.db.insert("followRequests", {
    aggregateId: `request-in-${who}`,
    requesterId: other,
    targetId: me,
    status: "pending",
    createdAt: now,
  });
  await ctx.db.insert("blocks", {
    blockerId: me,
    blockedId: blockee,
    createdAt: now,
  });

  // circles and household
  await ctx.db.insert("circles", {
    aggregateId: `circle-${who}`,
    ownerId: me,
    name: secret("circle"),
    memberships: [
      { id: `m-${who}`, memberId: me, permission: "Admin", joinedAt: now },
    ],
    createdAt: now,
  });
  await ctx.db.insert("circleMembers", {
    circleAggregateId: `circle-${who}`,
    memberId: me,
  });
  await ctx.db.insert("households", {
    aggregateId: `household-${who}`,
    createdAt: now,
    name: secret("household"),
  });
  await ctx.db.insert("householdMembers", {
    householdId: `household-${who}`,
    memberId: me,
    role: "admin",
    joinedAt: now,
  });

  // messaging
  const threadId = `thread-${who}`;
  await ctx.db.insert("threads", {
    aggregateId: threadId,
    subjectKind: "dm",
    participants: [me, other],
    participantsKey: [me, other].sort().join("|"),
    createdAt: now,
  });
  for (const memberId of [me, other]) {
    await ctx.db.insert("threadParticipants", {
      threadAggregateId: threadId,
      memberId,
    });
  }
  await ctx.db.insert("threadMessages", {
    threadAggregateId: threadId,
    messageId: `message-${who}`,
    authorId: me,
    kind: "text",
    body: secret("message"),
    sentAt: now,
  });
  await ctx.db.insert("threadMessages", {
    threadAggregateId: threadId,
    messageId: `reply-${who}`,
    authorId: other,
    kind: "text",
    body: `reply-to-${who}`,
    sentAt: now + 1,
  });
  await ctx.db.insert("messageAttachments", {
    kind: "image",
    threadAggregateId: threadId,
    uploaderId: me,
    fileId: await stored("message-photo"),
    byteSize: 10,
    contentType: "image/png",
    moderationStatus: "approved",
    hashCheckedAt: now,
    reencodedAt: now,
    caption: secret("caption"),
    messageId: `photo-message-${who}`,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("messageAttachments", {
    kind: "location",
    threadAggregateId: threadId,
    uploaderId: me,
    lat: 52.09,
    lng: 5.12,
    precision: "approximate",
    label: secret("place"),
    mapFileId: await stored("map"),
    mapStatus: "ready",
    messageId: `location-message-${who}`,
    createdAt: now,
    updatedAt: now,
  });

  // reports and invitations
  await ctx.db.insert("reports", {
    reporterId: me,
    targetKind: "user",
    targetId: other,
    reportedUserId: other,
    reason: "spam_scam",
    details: secret("report"),
    evidence: {},
    status: "open",
    createdAt: now,
  });
  await ctx.db.insert("emailInvites", {
    aggregateId: `email-invite-${who}`,
    kind: "follow",
    inviterId: me,
    createdAt: now,
    expiresAt: now + 1000,
  });
  await ctx.db.insert("inviteLinks", {
    ownerId: me,
    token: `token-${who}`,
    createdAt: now,
    landingViews: 1,
    signupsAttributed: 0,
    followsEstablished: 0,
  });

  return { me, blobs };
};

const seed = (t: T) =>
  t.run(async (ctx) => {
    const carol = await insertUser(ctx, "carol");
    const dave = await insertUser(ctx, "dave");
    const alice = await seedMember(ctx, "alice", carol, dave);
    const bob = await seedMember(ctx, "bob", carol, dave);
    return { alice, bob, carol, dave };
  });

// Every string in a JSON value, recursively.
const stringsIn = (value: unknown, out = new Set<string>()): Set<string> => {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) stringsIn(v, out);
  }
  return out;
};

describe("insights.exportUserDataPage", () => {
  test("refuses a caller who is not signed in", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.insights.exportUserDataPage.exportUserDataPage, {
        section: "account",
        cursor: null,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("every section holds the caller's rows and nothing of another member's", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);

    for (const [who, theirs] of [
      ["alice", bob],
      ["bob", alice],
    ] as const) {
      const data = await exportAll(t, who);
      for (const section of EXPORT_SECTIONS) {
        expect(data[section].length, section).toBeGreaterThan(0);
        const json = JSON.stringify(data[section]);
        const other = who === "alice" ? "bob" : "alice";
        expect(json, section).not.toContain(`${other}-secret-`);
        expect(json, section).not.toContain(theirs.me);
        expect(json, section).not.toContain(`${other}@example.com`);
      }
      const json = JSON.stringify(data);
      for (const field of [
        "display-name",
        "copy-notes",
        "photo-description",
        "completion-notes",
        "collection",
        "category",
        "goal",
        "puzzle-review",
        "puzzle-comment",
        "photo-comment",
        "partner-review",
        "proposal-comment",
        "submitted-title",
        "circle",
        "household",
        "message",
        "caption",
        "place",
        "report",
      ]) {
        expect(json, field).toContain(`${who}-secret-${field}`);
      }
      // The account is the caller's own; the device keys of a push subscription are not exported.
      expect(data.account[0]).toMatchObject({
        user: { email: `${who}@example.com` },
        quickStart: { skippedSteps: ["household"] },
      });
      expect(json).not.toContain(`${who}-secret-p256dh`);
      expect(json).not.toContain(`${who}-secret-auth`);
      // Only the caller's own message, never the counterpart's reply.
      expect(data.messagesSent.map((m) => m.body)).toEqual([
        `${who}-secret-message`,
      ]);
      expect(json).not.toContain(`reply-to-${who}`);
    }
  });

  test("no row carries a raw _storage id: photos are URLs", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const data = await exportAll(t, "alice");
    const strings = [...stringsIn(data)];
    const storageLike = await t.run(async (ctx) =>
      strings.filter((s) => ctx.db.system.normalizeId("_storage", s) !== null),
    );
    expect(storageLike).toEqual([]);
    for (const id of alice.blobs) {
      expect(strings).not.toContain(id);
    }
    expect(data.copyPhotos[0]).toMatchObject({
      status: "approved",
      url: expect.stringMatching(/^https:\/\//),
    });
    expect(data.completions[0]?.photos).toEqual([
      { url: expect.stringMatching(/^https:\/\//), pending: false },
    ]);
    expect(data.submittedPuzzles[0]).toMatchObject({
      imageUrl: expect.stringMatching(/^https:\/\//),
    });
    expect(data.attachmentsSent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          status: "ready",
          url: expect.stringMatching(/^https:\/\//),
        }),
        expect.objectContaining({
          kind: "location",
          mapUrl: expect.stringMatching(/^https:\/\//),
        }),
      ]),
    );
  });

  test("a section pages past the page size and returns every row once", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < EXPORT_PAGE_SIZE; i += 1) {
        await ctx.db.insert("goals", {
          userId: alice.me,
          title: `goal ${i}`,
          targetCompletions: 1,
          currentCompletions: 0,
          isActive: true,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    const first = await as(t, "alice").query(
      api.insights.exportUserDataPage.exportUserDataPage,
      { section: "goals", cursor: null },
    );
    expect(first.isDone).toBe(false);
    expect(first.rows).toHaveLength(EXPORT_PAGE_SIZE);
    const { rows, pages } = await exportSection(t, "alice", "goals");
    expect(pages).toBe(2);
    expect(rows).toHaveLength(EXPORT_PAGE_SIZE + 1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(EXPORT_PAGE_SIZE + 1);
  });

  test("a stopped photo reads the same whether it was rejected or quarantined", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const copy = (await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", alice.me))
        .first())!;
      for (const moderationStatus of ["rejected", "quarantined"] as const) {
        await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy._id,
          uploaderId: alice.me,
          fileId: await blob(ctx, moderationStatus),
          description: "stopped",
          moderationStatus,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("messageAttachments", {
          kind: "image",
          threadAggregateId: "thread-alice",
          uploaderId: alice.me,
          fileId: await blob(ctx, `message-${moderationStatus}`),
          byteSize: 10,
          contentType: "image/png",
          moderationStatus,
          caption: "stopped",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const data = await exportAll(t, "alice");
    const stopped = (rows: ExportRow[]) =>
      rows
        .filter((r) => r.description === "stopped" || r.caption === "stopped")
        .map(({ id: _id, ...rest }) => rest);

    const photos = stopped(data.copyPhotos);
    expect(photos).toHaveLength(2);
    expect(photos[0]).toEqual(photos[1]);
    expect(photos[0]).toMatchObject({ status: "notShown" });
    expect(photos[0]).not.toHaveProperty("url");

    const attachments = stopped(data.attachmentsSent);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toEqual(attachments[1]);
    expect(attachments[0]).toMatchObject({ status: "rejected" });
    expect(attachments[0]).not.toHaveProperty("url");
    expect(JSON.stringify(data)).not.toContain("quarantined");
  });

  test("a declined follow request reads as the requester sees it: pending in the cooldown, then gone", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const target = async (who: string) => insertUser(ctx, who);
      await ctx.db.insert("followRequests", {
        aggregateId: "declined-recently",
        requesterId: alice.me,
        targetId: await target("erin"),
        status: "declined",
        createdAt: now - 1000,
        respondedAt: now - 500,
      });
      await ctx.db.insert("followRequests", {
        aggregateId: "declined-long-ago",
        requesterId: alice.me,
        targetId: await target("frank"),
        status: "declined",
        createdAt: now - 2 * COOLDOWN_MS,
        respondedAt: now - 2 * COOLDOWN_MS,
      });
      await ctx.db.insert("followRequests", {
        aggregateId: "declined-then-cancelled",
        requesterId: alice.me,
        targetId: await target("gina"),
        status: "declined",
        createdAt: now - 1000,
        respondedAt: now - 500,
        cancelledAt: now - 100,
      });
    });
    const { rows } = await exportSection(t, "alice", "followRequestsSent");
    const json = JSON.stringify(rows);
    expect(json).not.toContain("declined");
    expect(json).not.toContain("respondedAt");
    expect(rows.map((r) => r.status).sort()).toEqual(["approved", "pending"]);
    expect(rows.find((r) => r.status === "pending")).toMatchObject({
      to: { name: "Erin" },
    });
  });
});
