import {
  ChangeProposalRejected,
  CircleDeleted,
  CollectionCreated,
  CommentPosted,
  CopyDetailsUpdated,
  MemberRegistered,
  PersonalCategoryCreated,
  PhotoCommentPosted,
  ProfileUpdated,
  toChangeProposalId,
  toCircleId,
  toCollectionId,
  toCommentId,
  toCopyId,
  toMemberId,
  toOwnerId,
  toPersonalCategoryId,
  toPhotoCommentId,
  toPhotoId,
  toProfileId,
  toPuzzleDefinitionId,
  toSubmitterId,
  type DomainEvent,
} from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recordAndSchedule } from "./events/recordAndSchedule";
import schema from "./schema";

// SEC-71: the durable event log never keeps the free text a member typed (comment text, copy
// notes, collection and category names, display name) or the identity they registered with
// (email, Clerk id). Nothing reads those fields from the log, so recordAndSchedule leaves them
// out, and events/redactPayloads strips them from rows recorded before.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const AT = new Date("2026-10-01T12:00:00Z");

const seedMember = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

// Records `events` the way every publisher does, and returns the stored payloads by event name.
// Their dispatch is cancelled: the subscribers would run on made-up ids, and only the stored
// payload matters here.
const record = async (t: T, events: DomainEvent[]) => {
  await t.run(async (ctx) => {
    await recordAndSchedule(ctx, "test", events);
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    for (const job of jobs) await ctx.scheduler.cancel(job._id);
  });
  const rows = await t.run((ctx) => ctx.db.query("domainEvents").collect());
  return new Map(rows.map((row) => [row.name, row.payload]));
};

describe("recordAndSchedule", () => {
  test("leaves typed free text and registration identity out of the payload", async () => {
    const t = convexTest(schema, modules);
    const member = toMemberId("m1");
    const payloads = await record(t, [
      new MemberRegistered(member, "clerk_m1", "m1@example.com", AT),
      new ProfileUpdated(toProfileId("p1"), member, "Em", AT),
      new CommentPosted(
        toCommentId("c1"),
        toPuzzleDefinitionId("pd1"),
        member,
        "my private thoughts",
        4,
        AT,
      ),
      new PhotoCommentPosted(
        toPhotoCommentId("pc1"),
        toPhotoId("ph1"),
        member,
        "nice table",
        AT,
      ),
      new CopyDetailsUpdated(toCopyId("copy1"), 2, "from my gran", AT),
      new CollectionCreated(
        toCollectionId("col1"),
        toOwnerId("m1"),
        "Gifts from Jan",
        false,
        AT,
      ),
      new PersonalCategoryCreated(
        toPersonalCategoryId("cat1"),
        toOwnerId("m1"),
        "Hospital stay",
        AT,
      ),
    ]);

    expect(Object.fromEntries(payloads)).toEqual({
      MemberRegistered: { memberId: "m1" },
      ProfileUpdated: { profileId: "p1", memberId: "m1" },
      CommentPosted: {
        commentId: "c1",
        puzzleId: "pd1",
        authorId: "m1",
        rating: 4,
      },
      PhotoCommentPosted: {
        commentId: "pc1",
        photoId: "ph1",
        authorId: "m1",
      },
      CopyDetailsUpdated: { copyId: "copy1", missingPiecesCount: 2 },
      CollectionCreated: {
        collectionId: "col1",
        ownerId: "m1",
        isWishlist: false,
      },
      PersonalCategoryCreated: { categoryId: "cat1", ownerId: "m1" },
    });
  });

  test("keeps the fields a subscriber reads: a rejection reason and a deleted circle's name", async () => {
    const t = convexTest(schema, modules);
    const payloads = await record(t, [
      new ChangeProposalRejected(
        toChangeProposalId("cp1"),
        toPuzzleDefinitionId("pd1"),
        toSubmitterId("m1"),
        "Duplicate of an existing entry",
        AT,
      ),
      new CircleDeleted(
        toCircleId("circle1"),
        toMemberId("m1"),
        [toMemberId("m2")],
        "Book club",
        AT,
      ),
    ]);

    expect(payloads.get("ChangeProposalRejected")).toEqual({
      changeProposalId: "cp1",
      puzzleDefinitionId: "pd1",
      proposedBy: "m1",
      reason: "Duplicate of an existing entry",
    });
    expect(payloads.get("CircleDeleted")).toEqual({
      circleId: "circle1",
      ownerId: "m1",
      memberIds: ["m2"],
      circleName: "Book club",
    });
  });

  test("a real mutation records its event without the typed name", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await t
      .withIdentity({ subject: "clerk_alice" })
      .mutation(api.library.createCollection.createCollection, {
        name: "Gifts from Jan",
      });
    const event = await t.run((ctx) =>
      ctx.db
        .query("domainEvents")
        .filter((q) => q.eq(q.field("name"), "CollectionCreated"))
        .first(),
    );
    expect(event?.payload).toMatchObject({ ownerId: alice });
    expect(JSON.stringify(event?.payload)).not.toContain("Gifts from Jan");
  });
});

describe("events/redactPayloads", () => {
  const insertEvent = (
    t: T,
    name: string,
    payload: Record<string, unknown>,
    processed = true,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("domainEvents", {
        name,
        payload,
        context: "test",
        occurredAt: AT.getTime(),
        ...(processed && { processedAt: AT.getTime() }),
      }),
    );

  const payloadOf = async (t: T, id: Id<"domainEvents">) =>
    (await t.run((ctx) => ctx.db.get(id)))?.payload;

  const seedLegacy = async (t: T) => ({
    comment: await insertEvent(t, "CommentPosted", {
      commentId: "c1",
      puzzleId: "pd1",
      authorId: "m1",
      text: "my private thoughts",
      rating: null,
    }),
    registered: await insertEvent(t, "MemberRegistered", {
      memberId: "m1",
      clerkId: "clerk_m1",
      email: "m1@example.com",
    }),
    inFlight: await insertEvent(
      t,
      "CopyDetailsUpdated",
      { copyId: "copy1", missingPiecesCount: 1, notes: "box dented" },
      false,
    ),
    rejected: await insertEvent(t, "ChangeProposalRejected", {
      changeProposalId: "cp1",
      puzzleDefinitionId: "pd1",
      proposedBy: "m1",
      reason: "Duplicate",
    }),
  });

  test("a dry run (the default) counts the rows and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedLegacy(t);
    const before = await t.run((ctx) => ctx.db.query("domainEvents").collect());

    const result = await t.mutation(
      internal.events.redactPayloads.redactPayloads,
      {},
    );

    expect(result).toEqual({ scanned: 4, redacted: 3 });
    expect(
      await t.run((ctx) => ctx.db.query("domainEvents").collect()),
    ).toEqual(before);
    expect(await payloadOf(t, ids.comment)).toMatchObject({
      text: "my private thoughts",
    });
  });

  test("a real run strips the fields from every row, over several pages, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedLegacy(t);

    vi.useFakeTimers();
    try {
      await t.mutation(internal.events.redactPayloads.redactPayloads, {
        dryRun: false,
        batchSize: 1,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    expect(await payloadOf(t, ids.comment)).toEqual({
      commentId: "c1",
      puzzleId: "pd1",
      authorId: "m1",
      rating: null,
    });
    expect(await payloadOf(t, ids.registered)).toEqual({ memberId: "m1" });
    expect(await payloadOf(t, ids.inFlight)).toEqual({
      copyId: "copy1",
      missingPiecesCount: 1,
    });
    expect(await payloadOf(t, ids.rejected)).toEqual({
      changeProposalId: "cp1",
      puzzleDefinitionId: "pd1",
      proposedBy: "m1",
      reason: "Duplicate",
    });

    const again = await t.mutation(
      internal.events.redactPayloads.redactPayloads,
      { dryRun: false },
    );
    expect(again).toEqual({ scanned: 4, redacted: 0 });
  });
});
