import presenceTest from "@convex-dev/presence/test";
import { CircleDeleted, toCircleId, toMemberId } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  scrubDeletedCopyEvent,
  scrubMemberEvents,
  scrubPayload,
} from "./conversation/purgeMemberEvents";
import { EVENT_SCRUB_DELAY_MS } from "./conversation/purgeMemberMessagingData";
import {
  EVENT_MEMBERS_BACKFILL,
  recordEventMembers,
} from "./events/eventMembers";
import { recordAndSchedule } from "./events/recordAndSchedule";
import schema from "./schema";

// Account deletion, last phase (spec 2026-10-19 deleted member ghost, phase 9): every finished
// domainEvents payload that names the deleted member gets "deleted-member" in place of their id and
// loses the personal fields it copied. Other members' ids and events, events still being
// dispatched, and the moderation records stay as they are.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const newT = (): T => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

const settleDueJobs = async (t: T) => {
  for (let i = 0; i < 400; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy = jobs.some(
      (job) =>
        job.state.kind === "inProgress" ||
        (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
    );
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

// The domainEvents phase starts EVENT_SCRUB_DELAY_MS after the rest of the purge. Run its pending
// jobs now (checking the delay), in place of the scheduler.
const runDelayedScrubs = async (t: T) => {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const scrubs = jobs.filter(
    (job) =>
      job.state.kind === "pending" &&
      job.name.includes("purgeMemberMessagingData") &&
      job.args[0].phase === "domainEvents",
  );
  for (const job of scrubs) {
    expect(job.scheduledTime - job._creationTime).toBeGreaterThanOrEqual(
      EVENT_SCRUB_DELAY_MS - 1000,
    );
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      job.args[0],
    );
  }
  await settleDueJobs(t);
  return scrubs.length;
};

const seedMembers = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return { alice: await mk("alice"), bob: await mk("bob") };
  });

type Dispatch = "processed" | "failed" | "pending";
const insertEvent = (
  t: T,
  name: string,
  payload: Record<string, unknown>,
  dispatch: Dispatch = "processed",
) =>
  t.run((ctx) =>
    ctx.db.insert("domainEvents", {
      name,
      payload,
      context: "test",
      occurredAt: Date.now(),
      ...(dispatch === "processed" && { processedAt: Date.now() }),
      ...(dispatch === "failed" && { failedAt: Date.now() }),
    }),
  );

const payloadOf = async (t: T, id: Id<"domainEvents">) =>
  (await t.run((ctx) => ctx.db.get(id)))!.payload;

describe("scrubPayload", () => {
  test("replaces the member's id anywhere and drops copied personal fields", () => {
    expect(
      scrubPayload(
        {
          memberId: "m1",
          clerkId: "clerk_m1",
          email: "m1@example.com",
          parties: ["m1", "m2"],
          nested: { ownerId: "m1", displayName: "Em", kept: 3 },
        },
        "m1",
      ),
    ).toEqual({
      memberId: "deleted-member",
      parties: ["deleted-member", "m2"],
      nested: { ownerId: "deleted-member", kept: 3 },
    });
  });

  test("a payload that does not name the member is left alone", () => {
    expect(
      scrubPayload({ memberId: "m2", displayName: "Bo" }, "m1"),
    ).toBeNull();
  });
});

describe("account deletion: domainEvents", () => {
  const deleteAlice = async (t: T) => {
    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
    await settleDueJobs(t);
    expect(await runDelayedScrubs(t)).toBe(1);
  };

  test("her finished events are scrubbed; Bob's, in-flight ones and moderation records stay", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const registered = await insertEvent(t, "MemberRegistered", {
      memberId: s.alice,
      clerkId: "clerk_alice",
      email: "alice@example.com",
    });
    const collection = await insertEvent(t, "CollectionCreated", {
      collectionId: "col-1",
      ownerId: s.alice,
      collectionName: "Gifts from Jan",
      isWishlist: false,
    });
    const transfer = await insertEvent(
      t,
      "CopyOwnershipTransferred",
      { copyId: "copy-1", previousOwner: s.alice, newOwner: s.bob },
      "failed",
    );
    const bobs = await insertEvent(t, "ProfileUpdated", {
      profileId: "p-bob",
      memberId: s.bob,
      displayName: "Bobby",
    });
    const inFlight = await insertEvent(
      t,
      "ProfileUpdated",
      { profileId: "p-alice", memberId: s.alice, displayName: "Al" },
      "pending",
    );
    const moderation = await t.run((ctx) =>
      ctx.db.insert("moderationActions", {
        actorId: s.bob,
        kind: "role_granted",
        targetLabel: "alice",
        targetId: "clerk_alice",
        at: Date.now(),
      }),
    );
    const moderationBefore = await t.run((ctx) => ctx.db.get(moderation));

    await deleteAlice(t);

    expect(await payloadOf(t, registered)).toEqual({
      memberId: "deleted-member",
    });
    expect(await payloadOf(t, collection)).toEqual({
      collectionId: "col-1",
      ownerId: "deleted-member",
      isWishlist: false,
    });
    expect(await payloadOf(t, transfer)).toEqual({
      copyId: "copy-1",
      previousOwner: "deleted-member",
      newOwner: s.bob,
    });
    expect(await payloadOf(t, bobs)).toEqual({
      profileId: "p-bob",
      memberId: s.bob,
      displayName: "Bobby",
    });
    expect(await payloadOf(t, inFlight)).toEqual({
      profileId: "p-alice",
      memberId: s.alice,
      displayName: "Al",
    });
    expect(await t.run((ctx) => ctx.db.get(moderation))).toEqual(
      moderationBefore,
    );
  });

  test("a small batch walks the whole log over several runs", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const ids: Id<"domainEvents">[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await insertEvent(t, "CopyMadeAvailable", {
          copyId: `copy-${i}`,
          ownerId: s.alice,
          notes: "from Jan",
        }),
      );
    }

    await deleteAlice(t);
    // Put one back, then scrub again in pages of 2.
    await t.run((ctx) =>
      ctx.db.patch(ids[4], {
        payload: { copyId: "copy-4", ownerId: s.alice, notes: "from Jan" },
      }),
    );
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, phase: "domainEvents", batchSize: 2 },
    );
    await settleDueJobs(t);

    for (const [i, id] of ids.entries()) {
      expect(await payloadOf(t, id)).toEqual({
        copyId: `copy-${i}`,
        ownerId: "deleted-member",
      });
    }
  });
});

describe("account deletion: events keyed by a copy alone", () => {
  // CopyDetailsUpdated names no member, only the copy, and carries the owner's notes.
  const details = (copyId: string, notes: string) => ({
    copyId,
    missingPiecesCount: 2,
    notes,
  });

  const insertCopy = (t: T, ownerId: Id<"users">, aggregateId: string) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: ownerId,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    });

  test("her copy's notes go with her copy; Bob's copy and in-flight events keep theirs", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await insertCopy(t, s.alice, "copy-alice");
    await insertCopy(t, s.bob, "copy-bob");
    const hers = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-alice", "from my gran"),
    );
    const hersFailed = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-alice", "box dented"),
      "failed",
    );
    const hersInFlight = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-alice", "still sending"),
      "pending",
    );
    const bobs = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-bob", "Bob's note"),
    );
    // A copy someone deleted earlier: nothing reads its notes either.
    const gone = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-gone", "old note"),
    );
    const noFields = await insertEvent(t, "CopyMadeUnavailable", {
      copyId: "copy-alice",
    });

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
    await settleDueJobs(t);
    expect(await runDelayedScrubs(t)).toBe(1);

    const copies = await t.run((ctx) => ctx.db.query("ownedPuzzles").collect());
    expect(copies.map((c) => c.aggregateId)).toEqual(["copy-bob"]);
    for (const id of [hers, hersFailed]) {
      expect(await payloadOf(t, id)).toEqual({
        copyId: "copy-alice",
        missingPiecesCount: 2,
      });
    }
    expect(await payloadOf(t, gone)).toEqual({
      copyId: "copy-gone",
      missingPiecesCount: 2,
    });
    expect(await payloadOf(t, hersInFlight)).toEqual(
      details("copy-alice", "still sending"),
    );
    expect(await payloadOf(t, bobs)).toEqual(details("copy-bob", "Bob's note"));
    expect(await payloadOf(t, noFields)).toEqual({ copyId: "copy-alice" });
  });

  test("a dry run reports the rewrite without making it; a copy is looked up once per page", async () => {
    const t = newT();
    const id = await insertEvent(
      t,
      "CopyDetailsUpdated",
      details("copy-gone", "old note"),
    );
    const outcome = await t.run(async (ctx) => {
      const event = (await ctx.db.get(id))!;
      const copyExists = new Map<string, boolean>();
      const dry = await scrubDeletedCopyEvent(ctx, event, copyExists, true);
      return { dry, cached: [...copyExists.entries()] };
    });
    expect(outcome).toEqual({ dry: true, cached: [["copy-gone", false]] });
    expect(await payloadOf(t, id)).toEqual(details("copy-gone", "old note"));
  });
});

describe("the event lookup (domainEventMembers)", () => {
  const lookupOf = (t: T) =>
    t.run(async (ctx) =>
      (await ctx.db.query("domainEventMembers").collect()).map((row) => ({
        eventId: row.eventId,
        memberId: row.memberId,
      })),
    );

  const markBackfilled = (t: T) =>
    t.run((ctx) =>
      ctx.db.insert("backfillMarkers", {
        name: EVENT_MEMBERS_BACKFILL,
        completedAt: Date.now(),
      }),
    );

  // An event as recordAndSchedule leaves it: the row and one lookup row per member it names.
  const insertIndexed = async (
    t: T,
    name: string,
    payload: Record<string, unknown>,
    dispatch: Dispatch = "processed",
  ) => {
    const id = await insertEvent(t, name, payload, dispatch);
    await t.run((ctx) => recordEventMembers(ctx, id, payload));
    return id;
  };

  const sorted = <R extends { eventId: string; memberId: string }>(rows: R[]) =>
    [...rows].sort((a, b) =>
      `${a.eventId}${a.memberId}`.localeCompare(`${b.eventId}${b.memberId}`),
    );

  test("recordAndSchedule writes one row per member the payload names", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await t.run(async (ctx) => {
      await recordAndSchedule(ctx, "test", [
        new CircleDeleted(
          toCircleId("circle-1"),
          toMemberId(s.alice),
          [toMemberId(s.bob), toMemberId(s.alice)],
          "Book club",
          new Date(),
        ),
      ]);
      // Only the lookup matters here, not the dispatch.
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      for (const job of jobs) await ctx.scheduler.cancel(job._id);
    });
    const [event] = await t.run((ctx) =>
      ctx.db.query("domainEvents").collect(),
    );

    expect(sorted(await lookupOf(t))).toEqual(
      sorted([
        { eventId: event._id, memberId: s.alice },
        { eventId: event._id, memberId: s.bob },
      ]),
    );
  });

  test("the backfill adds the missing rows once, then marks itself done; a dry run writes nothing", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const legacy = await insertEvent(t, "CopyOwnershipTransferred", {
      copyId: "copy-1",
      previousOwner: s.alice,
      newOwner: s.bob,
    });
    const unnamed = await insertEvent(t, "CopyMadeAvailable", {
      copyId: "copy-1",
    });
    const recorded = await insertIndexed(t, "MemberFollowed", {
      followId: "f-1",
      followerId: s.bob,
      followeeId: s.alice,
    });
    const before = await lookupOf(t);

    const dry = await t.mutation(
      internal.events.eventMembers.backfillEventMembers,
      {},
    );
    expect(dry).toEqual({ scanned: 3, added: 2 });
    expect(await lookupOf(t)).toEqual(before);
    expect(
      await t.run((ctx) => ctx.db.query("backfillMarkers").collect()),
    ).toEqual([]);

    await t.mutation(internal.events.eventMembers.backfillEventMembers, {
      dryRun: false,
      batchSize: 1,
    });
    await settleDueJobs(t);

    expect(sorted(await lookupOf(t))).toEqual(
      sorted([
        { eventId: legacy, memberId: s.alice },
        { eventId: legacy, memberId: s.bob },
        { eventId: recorded, memberId: s.bob },
        { eventId: recorded, memberId: s.alice },
      ]),
    );
    expect((await lookupOf(t)).some((row) => row.eventId === unnamed)).toBe(
      false,
    );
    const markers = await t.run((ctx) =>
      ctx.db.query("backfillMarkers").collect(),
    );
    expect(markers.map((m) => m.name)).toEqual([EVENT_MEMBERS_BACKFILL]);

    const again = await t.mutation(
      internal.events.eventMembers.backfillEventMembers,
      { dryRun: false },
    );
    expect(again).toEqual({ scanned: 3, added: 0 });
    expect(
      await t.run((ctx) => ctx.db.query("backfillMarkers").collect()),
    ).toHaveLength(1);
  });

  describe.each([
    ["before the lookup backfill (paging the log)", false],
    ["after the lookup backfill (by index)", true],
  ])("account deletion %s", (_label, backfilled) => {
    test("her own feed events go, the rest is scrubbed, and her lookup rows go with them", async () => {
      const t = newT();
      const s = await seedMembers(t);
      if (backfilled) await markBackfilled(t);
      const solved = await insertIndexed(t, "CompletionRecorded", {
        completionId: "c-1",
        userId: s.alice,
      });
      const started = await insertIndexed(t, "CompletionStarted", {
        completionId: "c-2",
        userId: s.alice,
      });
      const acquired = await insertIndexed(t, "CopyAcquired", {
        copyId: "copy-a",
        ownerId: s.alice,
      });
      const bobsAcquired = await insertIndexed(t, "CopyAcquired", {
        copyId: "copy-b",
        ownerId: s.bob,
      });
      const transfer = await insertIndexed(t, "CopyOwnershipTransferred", {
        copyId: "copy-c",
        previousOwner: s.alice,
        newOwner: s.bob,
      });
      const inFlight = await insertIndexed(
        t,
        "CompletionRecorded",
        { completionId: "c-3", userId: s.alice },
        "pending",
      );

      await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
      await settleDueJobs(t);
      expect(await runDelayedScrubs(t)).toBe(1);

      const events = await t.run((ctx) =>
        ctx.db.query("domainEvents").collect(),
      );
      const ids = events.map((e) => e._id);
      expect(ids).not.toContain(solved);
      expect(ids).not.toContain(started);
      expect(ids).not.toContain(acquired);
      expect(ids).toContain(bobsAcquired);
      expect(ids).toContain(inFlight);
      expect(await payloadOf(t, transfer)).toEqual({
        copyId: "copy-c",
        previousOwner: "deleted-member",
        newOwner: s.bob,
      });
      // Bob's rows stay; of hers, only the in-flight event's, for a later run.
      expect(sorted(await lookupOf(t))).toEqual(
        sorted([
          { eventId: bobsAcquired, memberId: s.bob },
          { eventId: transfer, memberId: s.bob },
          { eventId: inFlight, memberId: s.alice },
        ]),
      );
    });
  });

  test("after the backfill the purge reads only her events: one the lookup misses is not visited", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await markBackfilled(t);
    const indexed = await insertIndexed(t, "CopyMadeAvailable", {
      copyId: "copy-1",
      ownerId: s.alice,
    });
    const missed = await insertEvent(t, "CopyMadeAvailable", {
      copyId: "copy-2",
      ownerId: s.alice,
    });

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
    await settleDueJobs(t);
    await runDelayedScrubs(t);

    expect(await payloadOf(t, indexed)).toEqual({
      copyId: "copy-1",
      ownerId: "deleted-member",
    });
    expect(await payloadOf(t, missed)).toEqual({
      copyId: "copy-2",
      ownerId: s.alice,
    });
  });

  test("by index, stale and duplicate lookup rows are cleared without failing the run", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await markBackfilled(t);
    const named = await insertIndexed(t, "CopyMadeAvailable", {
      copyId: "copy-1",
      ownerId: s.alice,
    });
    // A second row for the same event and member, and one whose event is already gone.
    await t.run(async (ctx) => {
      await ctx.db.insert("domainEventMembers", {
        eventId: named,
        memberId: s.alice,
      });
      const gone = await ctx.db.insert("domainEvents", {
        name: "CopyMadeAvailable",
        payload: { copyId: "copy-2", ownerId: s.alice },
        context: "test",
        occurredAt: Date.now(),
        processedAt: Date.now(),
      });
      await ctx.db.insert("domainEventMembers", {
        eventId: gone,
        memberId: s.alice,
      });
      await ctx.db.delete(gone);
    });

    const page = await t.run((ctx) =>
      scrubMemberEvents(ctx, s.alice, { cursor: null, numItems: 10 }),
    );

    expect(page.isDone).toBe(true);
    expect(await payloadOf(t, named)).toEqual({
      copyId: "copy-1",
      ownerId: "deleted-member",
    });
    expect(await lookupOf(t)).toEqual([]);
  });

  test("a purge that started paging the log finishes paging it when the backfill completes meanwhile", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const first = await insertEvent(t, "CopyMadeAvailable", {
      copyId: "copy-1",
      ownerId: s.alice,
    });
    const second = await insertEvent(t, "CopyMadeAvailable", {
      copyId: "copy-2",
      ownerId: s.alice,
    });

    const page1 = await t.run((ctx) =>
      scrubMemberEvents(ctx, s.alice, { cursor: null, numItems: 1 }),
    );
    expect(page1.continueCursor.startsWith("scan:")).toBe(true);
    await markBackfilled(t);
    const page2 = await t.run((ctx) =>
      scrubMemberEvents(ctx, s.alice, {
        cursor: page1.continueCursor,
        numItems: 1,
      }),
    );
    expect(page2.continueCursor.startsWith("scan:")).toBe(true);

    for (const [id, copyId] of [
      [first, "copy-1"],
      [second, "copy-2"],
    ] as const) {
      expect(await payloadOf(t, id)).toEqual({
        copyId,
        ownerId: "deleted-member",
      });
    }
  });
});
