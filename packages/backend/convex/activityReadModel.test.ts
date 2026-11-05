import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { EVENT_SCRUB_DELAY_MS } from "./conversation/purgeMemberMessagingData";
import schema from "./schema";
import { FEED_MAX_AUDIENCE } from "./social/getActivityFeed";

// The activity feed's per-actor read model (SEC-30, PERF-B3m): social/activityEntries projects the
// feed's events into one row per (actor, kind, ref), written by the event dispatcher and, for the
// events recorded before it existed, by social/backfillActivityEntries.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const newT = (transactionLimits?: { documentsRead: number }): T => {
  const t = convexTest({ schema, modules, transactionLimits });
  presenceTest.register(t);
  return t;
};

// Runs every scheduled function that is due (the event dispatcher, a backfill's next batch, the
// purge's next run), until none is left. Delayed ones (the purge's event scrub) stay pending.
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

const asUser = (t: T, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

// alice, bob, carol and two approved definitions.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    const definitions: string[] = [];
    const puzzleIds: Id<"puzzles">[] = [];
    for (let i = 0; i < 6; i++) {
      const aggregateId = crypto.randomUUID();
      puzzleIds.push(
        await ctx.db.insert("puzzles", {
          aggregateId,
          title: `Puzzle ${i}`,
          pieceCount: 1000,
          searchableText: `Puzzle ${i}`,
          status: "approved",
          submittedBy: carol,
          createdAt: now,
          updatedAt: now,
        }),
      );
      definitions.push(aggregateId);
    }
    return { alice, bob, carol, definitions, puzzleIds };
  });

const follow = (t: T, follower: Id<"users">, followee: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: follower,
      followeeId: followee,
      createdAt: Date.now(),
    });
  });

// One acquireCopy call; `open` lists it for trade so a non-owner may view it (canViewCopy).
const addCopy = async (
  t: T,
  who: string,
  definitionId: string,
  open: boolean,
) => {
  const copyId = await asUser(t, who).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: definitionId, condition: "good" },
  );
  if (open) {
    await asUser(t, who).mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible", forTrade: true },
    );
  }
  return copyId;
};

// A completed exchange between two members, with its ExchangeCompleted event recorded and
// dispatched the way the exchange context does (recordAndSchedule).
const completeExchange = (
  t: T,
  initiatorId: Id<"users">,
  recipientId: Id<"users">,
  puzzleId: Id<"puzzles">,
  occurredAt = Date.now(),
) =>
  t.run(async (ctx) => {
    const aggregateId = crypto.randomUUID();
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: recipientId,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    await ctx.db.insert("exchanges", {
      aggregateId,
      initiatorId,
      recipientId,
      type: "trade",
      requestedPuzzleId: copyId,
      status: "completed",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    const eventId = await ctx.db.insert("domainEvents", {
      name: "ExchangeCompleted",
      payload: { exchangeId: aggregateId },
      occurredAt,
      context: "exchange",
    });
    await ctx.scheduler.runAfter(0, internal.events.dispatch.dispatch, {
      eventId,
    });
    return aggregateId;
  });

type Row = Omit<Doc<"activityEntries">, "_id" | "_creationTime">;

// Every projected row, without system fields, in a stable order.
const projectedRows = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("activityEntries").collect())
      .map(({ _id, _creationTime, ...row }): Row => ({
        ...row,
        ...(row.copyIds && { copyIds: [...row.copyIds].sort() }),
      }))
      .sort(
        (a, b) =>
          a.actorId.localeCompare(b.actorId) ||
          a.kind.localeCompare(b.kind) ||
          a.ref.localeCompare(b.ref),
      ),
  );

const rowsOf = async (t: T, actorId: Id<"users">) =>
  (await projectedRows(t)).filter((row) => row.actorId === actorId);

const eventsNamed = (t: T, name: string) =>
  t.run((ctx) =>
    ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", name))
      .collect(),
  );

type BackfillLine = {
  dry_run: boolean;
  is_done: boolean;
  totals: { events: number; inserted: number; updated: number };
};
// The backfill's log lines, oldest first.
const backfillLines = (): BackfillLine[] =>
  logs
    .filter((line) => line.includes('"social.backfillActivityEntries"'))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))) as BackfillLine);

const runBackfill = async (
  t: T,
  args: { dryRun?: boolean; batchSize?: number } = {},
) => {
  await t.mutation(
    internal.social.backfillActivityEntries.backfillActivityEntries,
    args,
  );
  await settleDueJobs(t);
  const lines = backfillLines();
  const last = lines[lines.length - 1];
  expect(last?.is_done).toBe(true);
  return last!.totals;
};

describe("activity projection — written by the event dispatcher", () => {
  test("each feed event becomes one row per actor; backfill-style solves never do", async () => {
    const t = newT();
    const { alice, bob, definitions, puzzleIds } = await seed(t);

    const single = await addCopy(t, "alice", definitions[0], true);
    const { copyIds: batch } = await asUser(t, "alice").mutation(
      api.library.acquireCopies.acquireCopies,
      {
        items: definitions
          .slice(1, 4)
          .map((puzzleDefinitionId) => ({ puzzleDefinitionId })),
      },
    );
    const { completionId: dated } = await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: single,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    );
    // A year-only solve and a past-solves batch are backfills: never activity.
    await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: single, datePrecision: "year", year: 2020 },
    );
    await asUser(t, "alice").mutation(
      api.solving.recordPastCompletions.recordPastCompletions,
      {
        items: [
          { copyId: batch[0], datePrecision: "day", date: Date.now() - DAY },
        ],
      },
    );
    const startDate = Date.now() + DAY;
    const started = await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: single, startDate },
    );
    const exchange = await completeExchange(t, bob, alice, puzzleIds[5]);
    await settleDueJobs(t);

    const batchId = (await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", batch[0]))
        .unique(),
    ))!.acquisitionBatchId!;
    const at = async (
      name: string,
      match: (p: Record<string, unknown>) => boolean,
    ) =>
      (await eventsNamed(t, name)).find((e) =>
        match(e.payload as Record<string, unknown>),
      )!.occurredAt;
    const batchAt = Math.max(
      ...(await eventsNamed(t, "CopyAcquired"))
        .filter((e) => (e.payload as { batchId?: string }).batchId === batchId)
        .map((e) => e.occurredAt),
    );

    expect(await rowsOf(t, alice)).toEqual(
      [
        {
          actorId: alice,
          kind: "acquisition",
          ref: single,
          occurredAt: await at("CopyAcquired", (p) => p.copyId === single),
        },
        {
          actorId: alice,
          kind: "acquisitionBatch",
          ref: batchId,
          occurredAt: batchAt,
          copyIds: [...batch].sort(),
        },
        {
          actorId: alice,
          kind: "completion",
          ref: dated,
          occurredAt: await at(
            "CompletionRecorded",
            (p) => p.completionId === dated,
          ),
        },
        {
          actorId: alice,
          kind: "exchange",
          ref: exchange,
          occurredAt: await at(
            "ExchangeCompleted",
            (p) => p.exchangeId === exchange,
          ),
          partyIds: [bob, alice],
        },
        {
          actorId: alice,
          kind: "started",
          ref: started,
          occurredAt: await at(
            "CompletionStarted",
            (p) => p.completionId === started,
          ),
          startDate,
        },
      ].sort((a, b) => a.kind.localeCompare(b.kind)),
    );
    // The counterparty gets their own exchange row.
    expect(await rowsOf(t, bob)).toEqual([
      expect.objectContaining({
        kind: "exchange",
        ref: exchange,
        partyIds: [bob, alice],
      }),
    ]);
  });

  test("running the handler again, or out of order, leaves one row per entry", async () => {
    const t = newT();
    const { alice, bob, definitions, puzzleIds } = await seed(t);
    await addCopy(t, "alice", definitions[0], false);
    const { copyIds } = await asUser(t, "alice").mutation(
      api.library.acquireCopies.acquireCopies,
      {
        items: definitions
          .slice(1, 4)
          .map((puzzleDefinitionId) => ({ puzzleDefinitionId })),
      },
    );
    await completeExchange(t, alice, bob, puzzleIds[5]);
    await settleDueJobs(t);
    const once = await projectedRows(t);
    expect(once).toHaveLength(4);

    // Replay every feed event, newest first, as a retry or a backfill would.
    const events = (
      await Promise.all(
        ["CopyAcquired", "ExchangeCompleted"].map((name) =>
          eventsNamed(t, name),
        ),
      )
    )
      .flat()
      .reverse();
    for (const event of events) {
      await t.mutation(internal.events.dispatch.runSubscriber, {
        eventId: event._id,
        handler: "activityFeed",
      });
    }
    expect(await projectedRows(t)).toEqual(once);
    const [batchRow] = (await rowsOf(t, alice)).filter(
      (row) => row.kind === "acquisitionBatch",
    );
    expect(batchRow.copyIds).toEqual([...copyIds].sort());
  });

  test("a batch folds into one row at its newest event time, whatever order its events arrive in", async () => {
    const t = newT();
    const { alice } = await seed(t);
    const now = Date.now();
    const ids = await t.run(async (ctx) =>
      Promise.all(
        [now - 2 * HOUR, now - HOUR, now - 3 * HOUR].map((occurredAt, i) =>
          ctx.db.insert("domainEvents", {
            name: "CopyAcquired",
            payload: { copyId: `copy-${i}`, ownerId: alice, batchId: "b-1" },
            occurredAt,
            context: "library",
          }),
        ),
      ),
    );
    for (const eventId of ids) {
      await t.mutation(internal.events.dispatch.runSubscriber, {
        eventId,
        handler: "activityFeed",
      });
    }
    expect(await rowsOf(t, alice)).toEqual([
      {
        actorId: alice,
        kind: "acquisitionBatch",
        ref: "b-1",
        occurredAt: now - HOUR,
        copyIds: ["copy-0", "copy-1", "copy-2"],
      },
    ]);
  });

  test("no row for a scrubbed payload or a departed member", async () => {
    const t = newT();
    const { alice, bob, carol, puzzleIds } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(bob, { isActive: false });
      await ctx.db.delete(carol);
    });
    const ids = await t.run(async (ctx) =>
      Promise.all(
        [
          { userId: "deleted-member", completionId: "c-1" },
          { userId: bob, completionId: "c-2" },
          { userId: carol, completionId: "c-3" },
          { userId: alice, completionId: "c-4" },
        ].map((payload) =>
          ctx.db.insert("domainEvents", {
            name: "CompletionRecorded",
            payload,
            occurredAt: Date.now(),
            context: "solving",
          }),
        ),
      ),
    );
    for (const eventId of ids) {
      await t.mutation(internal.events.dispatch.runSubscriber, {
        eventId,
        handler: "activityFeed",
      });
    }
    // An exchange with a departed party: only the active party gets a row.
    await completeExchange(t, bob, alice, puzzleIds[0]);
    await settleDueJobs(t);

    expect((await projectedRows(t)).map((r) => [r.kind, r.ref])).toEqual([
      ["completion", "c-4"],
      ["exchange", expect.any(String)],
    ]);
    expect((await projectedRows(t)).every((r) => r.actorId === alice)).toBe(
      true,
    );
  });
});

describe("activity projection — account purge", () => {
  // The domainEvents phase starts EVENT_SCRUB_DELAY_MS after the rest of the purge. Run its pending
  // jobs now, in place of the scheduler.
  const runDelayedScrubs = async (t: T) => {
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    for (const job of jobs) {
      if (
        job.state.kind !== "pending" ||
        !job.name.includes("purgeMemberMessagingData") ||
        job.args[0].phase !== "domainEvents"
      ) {
        continue;
      }
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
  };

  test("deleting an account removes their rows, before the event scrub, and nobody else's", async () => {
    const t = newT();
    const { alice, bob, definitions, puzzleIds } = await seed(t);
    for (const definitionId of definitions.slice(0, 3)) {
      await addCopy(t, "alice", definitionId, true);
    }
    await addCopy(t, "bob", definitions[3], true);
    const exchange = await completeExchange(t, alice, bob, puzzleIds[5]);
    await settleDueJobs(t);
    expect(await rowsOf(t, alice)).toHaveLength(4);

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });
    await settleDueJobs(t);
    // Gone before the delayed event scrub runs.
    expect(await rowsOf(t, alice)).toEqual([]);
    await runDelayedScrubs(t);

    expect(await rowsOf(t, alice)).toEqual([]);
    expect((await rowsOf(t, bob)).map((r) => [r.kind, r.ref])).toEqual([
      ["acquisition", expect.any(String)],
      ["exchange", exchange],
    ]);
    // Replaying her (now scrubbed) events projects nothing for her.
    for (const event of await eventsNamed(t, "CopyAcquired")) {
      await t.mutation(internal.events.dispatch.runSubscriber, {
        eventId: event._id,
        handler: "activityFeed",
      });
    }
    expect(await rowsOf(t, alice)).toEqual([]);
  });

  test("a small batch walks all of their rows over several runs", async () => {
    const t = newT();
    const { alice, bob } = await seed(t);
    await t.run(async (ctx) => {
      for (const actorId of [alice, bob]) {
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert("activityEntries", {
            actorId,
            kind: "completion",
            ref: `${actorId}-${i}`,
            occurredAt: Date.now() - i,
          });
        }
      }
    });

    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: alice, phase: "activityEntries", batchSize: 2 },
    );
    await settleDueJobs(t);

    expect(await rowsOf(t, alice)).toEqual([]);
    expect(await rowsOf(t, bob)).toHaveLength(5);
  });
});

describe("activity projection — backfill", () => {
  const readyFlag = (t: T) =>
    t.run((ctx) =>
      ctx.db
        .query("readModelStatus")
        .withIndex("by_name", (q) => q.eq("name", "activityEntries"))
        .unique(),
    );

  // Feed events recorded before the projection existed: inserted, never dispatched.
  const seedHistory = (t: T, alice: Id<"users">, bob: Id<"users">) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const copyId = await ctx.db.insert("ownedPuzzles", {
        ownerId: bob,
        puzzleId: (await ctx.db.query("puzzles").first())!._id,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-1",
        initiatorId: alice,
        recipientId: bob,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      const events: [string, Record<string, unknown>, number][] = [
        [
          "CompletionRecorded",
          { userId: alice, completionId: "c-new" },
          now - DAY,
        ],
        [
          "CompletionRecorded",
          { userId: alice, completionId: "c-old" },
          now - 91 * DAY,
        ],
        [
          "CompletionRecorded",
          { userId: alice, completionId: "c-bulk", bulk: true },
          now - DAY,
        ],
        [
          "CompletionStarted",
          { userId: bob, completionId: "s-1", startDate: now - DAY },
          now - DAY,
        ],
        ["CopyAcquired", { ownerId: bob, copyId: "single-1" }, now - 2 * DAY],
        [
          "CopyAcquired",
          { ownerId: alice, copyId: "b-copy-1", batchId: "b-1" },
          now - 3 * DAY,
        ],
        [
          "CopyAcquired",
          { ownerId: alice, copyId: "b-copy-2", batchId: "b-1" },
          now - 3 * DAY,
        ],
        ["CopyAcquired", { ownerId: alice, copyId: "old-1" }, now - 100 * DAY],
        ["ExchangeCompleted", { exchangeId: "exch-1" }, now - HOUR],
        // Not a feed event.
        ["CopyConditionChanged", { copyId: "single-1" }, now - HOUR],
      ];
      for (const [name, payload, occurredAt] of events) {
        await ctx.db.insert("domainEvents", {
          name,
          payload,
          occurredAt,
          context: "test",
          processedAt: occurredAt,
        });
      }
      return now;
    });

  test("projects the last 90 days of feed events, then marks the read model ready", async () => {
    const t = newT();
    const { alice, bob } = await seed(t);
    const now = await seedHistory(t, alice, bob);

    // Dry run: counts, writes nothing, sets no flag. It cannot see rows it did not write, so the
    // batch's second copy counts as an insert there and as an update in the real run.
    expect(await runBackfill(t, { dryRun: true })).toEqual({
      events: 7,
      inserted: 7,
      updated: 0,
    });
    expect(await projectedRows(t)).toEqual([]);
    expect(await readyFlag(t)).toBeNull();

    // A small batch walks every feed event name over several runs.
    expect(await runBackfill(t, { batchSize: 2 })).toEqual({
      events: 7,
      inserted: 6,
      updated: 1,
    });
    expect(
      (await projectedRows(t)).map((r) => [r.actorId, r.kind, r.ref]),
    ).toEqual(
      [
        [alice, "acquisitionBatch", "b-1"],
        [alice, "completion", "c-new"],
        [alice, "exchange", "exch-1"],
        [bob, "acquisition", "single-1"],
        [bob, "exchange", "exch-1"],
        [bob, "started", "s-1"],
      ].sort((a, b) => a[0].localeCompare(b[0])),
    );
    expect(
      (await projectedRows(t)).find((r) => r.kind === "acquisitionBatch")
        ?.copyIds,
    ).toEqual(["b-copy-1", "b-copy-2"]);
    expect(
      (await projectedRows(t)).find((r) => r.kind === "started")?.startDate,
    ).toBe(now - DAY);
    expect((await readyFlag(t))?.completedAt).toEqual(expect.any(Number));
  });

  test("a re-run writes nothing", async () => {
    const t = newT();
    const { alice, bob } = await seed(t);
    await seedHistory(t, alice, bob);
    await runBackfill(t);
    const rows = await projectedRows(t);

    expect(await runBackfill(t)).toEqual({
      events: 7,
      inserted: 0,
      updated: 0,
    });
    expect(await projectedRows(t)).toEqual(rows);
  });

  test("replaying what the dispatcher already projected gives the same rows", async () => {
    const t = newT();
    const { alice, bob, definitions, puzzleIds } = await seed(t);
    await addCopy(t, "alice", definitions[0], true);
    await asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
      items: definitions
        .slice(1, 3)
        .map((puzzleDefinitionId) => ({ puzzleDefinitionId })),
    });
    await completeExchange(t, alice, bob, puzzleIds[5]);
    await settleDueJobs(t);
    const dispatched = await projectedRows(t);
    expect(dispatched).toHaveLength(4);

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("activityEntries").collect()) {
        await ctx.db.delete(row._id);
      }
    });
    await runBackfill(t);
    expect(await projectedRows(t)).toEqual(dispatched);
  });
});

// ---- The feed's read of the projection ----

const feedOf = (t: T, viewer: string, limit?: number) =>
  asUser(t, viewer).query(
    api.social.getActivityFeed.getActivityFeed,
    limit === undefined ? {} : { limit },
  );
type Feed = Awaited<ReturnType<typeof feedOf>>;

// The readModelStatus flag the backfill's last batch writes; set or cleared directly here.
const setReady = (t: T, ready: boolean) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("readModelStatus")
      .withIndex("by_name", (q) => q.eq("name", "activityEntries"))
      .unique();
    if (ready && !row) {
      await ctx.db.insert("readModelStatus", {
        name: "activityEntries",
        completedAt: Date.now(),
      });
    }
    if (!ready && row) await ctx.db.delete(row._id);
  });

// Entries that share a millisecond may come out in either order; compare them in a fixed one.
const canonical = (feed: Feed) =>
  [...feed].sort(
    (a, b) =>
      b.occurredAt - a.occurredAt ||
      a.kind.localeCompare(b.kind) ||
      a.ref.localeCompare(b.ref),
  );

// `viewer`'s feed read the legacy way (domainEvents) and from the read model; they must agree.
const compareBothWays = async (t: T, viewer: string, limit?: number) => {
  await setReady(t, false);
  const legacy = await feedOf(t, viewer, limit);
  await setReady(t, true);
  const projected = await feedOf(t, viewer, limit);
  expect(canonical(projected)).toEqual(canonical(legacy));
  expect(projected.map((e) => e.occurredAt)).toEqual(
    [...projected.map((e) => e.occurredAt)].sort((a, b) => b - a),
  );
  return projected;
};

// The same, once the dispatcher has projected every event.
const feedBothWays = async (t: T, viewer: string, limit?: number) => {
  await settleDueJobs(t);
  return compareBothWays(t, viewer, limit);
};

const refsOf = (feed: Feed, kind: string) =>
  feed.filter((e) => e.kind === kind).map((e) => e.ref);

const addMallory = (t: T) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_mallory",
      email: "mallory@example.com",
      name: "mallory",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

describe("activity feed — reads the projection once backfilled (SEC-30)", () => {
  test("a flood of another member's events no longer hides a followee's activity", async () => {
    const t = newT();
    const { alice, bob, carol, definitions, puzzleIds } = await seed(t);
    const mallory = await addMallory(t);
    await follow(t, alice, bob);
    await follow(t, bob, alice);
    await asUser(t, "bob").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    const copy = await addCopy(t, "bob", definitions[0], true);
    const { completionId } = await asUser(t, "bob").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copy,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    );
    const started = await asUser(t, "bob").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copy, startDate: Date.now() - HOUR },
    );
    const exchange = await completeExchange(t, bob, carol, puzzleIds[5]);
    await settleDueJobs(t);
    const bobs = [
      ["acquisition", copy],
      ["completion", completionId],
      ["exchange", exchange],
      ["started", started],
    ];
    const bobsIn = (feed: Feed) =>
      feed
        .filter((e) => e.memberId === bob)
        .map((e) => [e.kind, e.ref])
        .sort((a, b) => a[0].localeCompare(b[0]));
    expect(bobsIn(await feedOf(t, "alice"))).toEqual(bobs);

    // Mallory, whom Alice does not follow, logs 500 newer events of every feed name. Inserted
    // directly: the daily caps would stop a real client sooner, which is not the point here.
    const floodAt = Date.now() + 1000;
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        const occurredAt = floodAt + i;
        const payloads: [string, Record<string, unknown>][] = [
          ["CompletionRecorded", { userId: mallory, completionId: `fc-${i}` }],
          [
            "CompletionStarted",
            { userId: mallory, completionId: `fs-${i}`, startDate: 0 },
          ],
          ["CopyAcquired", { ownerId: mallory, copyId: `fa-${i}` }],
          ["ExchangeCompleted", { exchangeId: `fx-${i}` }],
        ];
        for (const [name, payload] of payloads) {
          await ctx.db.insert("domainEvents", {
            name,
            payload,
            occurredAt,
            context: "test",
            processedAt: occurredAt,
          });
        }
      }
    });
    // Before the backfill the feed still reads the global window: Bob's activity is gone.
    expect(bobsIn(await feedOf(t, "alice"))).toEqual([]);

    await runBackfill(t);
    expect(bobsIn(await feedOf(t, "alice"))).toEqual(bobs);
  });

  test("a followee's hidden entries take only their own share of the read", async () => {
    const t = newT();
    const { alice, bob, definitions } = await seed(t);
    const mallory = await addMallory(t);
    await follow(t, alice, bob);
    await follow(t, alice, mallory);
    const copy = await addCopy(t, "bob", definitions[0], true);
    await settleDueJobs(t);
    // 600 newer acquisitions of copies Alice cannot see (they no longer exist).
    await t.run(async (ctx) => {
      for (let i = 0; i < 600; i++) {
        await ctx.db.insert("activityEntries", {
          actorId: mallory,
          kind: "acquisition",
          ref: `gone-${i}`,
          occurredAt: Date.now() + 1000 + i,
        });
      }
    });
    await setReady(t, true);

    expect(refsOf(await feedOf(t, "alice"), "acquisition")).toEqual([copy]);
  });

  test("the feed's reads do not grow with other members' activity", async () => {
    const t = newT({ documentsRead: 300 });
    const { alice, bob, definitions } = await seed(t);
    await follow(t, alice, bob);
    const copy = await addCopy(t, "bob", definitions[0], true);
    await settleDueJobs(t);
    // 40 members Alice does not follow, 75 events and projected rows each.
    await t.run(async (ctx) => {
      for (let m = 0; m < 40; m++) {
        const actorId = await ctx.db.insert("users", {
          clerkId: `clerk_other_${m}`,
          name: `other ${m}`,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        for (let i = 0; i < 75; i++) {
          const occurredAt = Date.now() + 1000 + i;
          await ctx.db.insert("domainEvents", {
            name: "CompletionRecorded",
            payload: { userId: actorId, completionId: `o-${m}-${i}` },
            occurredAt,
            context: "test",
            processedAt: occurredAt,
          });
          await ctx.db.insert("activityEntries", {
            actorId,
            kind: "completion",
            ref: `o-${m}-${i}`,
            occurredAt,
          });
        }
      }
    });

    await setReady(t, true);
    expect(refsOf(await feedOf(t, "alice"), "acquisition")).toEqual([copy]);
    // The legacy path reads the global window and runs out of reads.
    await setReady(t, false);
    await expect(feedOf(t, "alice")).rejects.toThrow(/too many documents/);
  });

  test("a member following more people than the feed can merge still gets a feed", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { databaseQueries: FEED_MAX_AUDIENCE + 500 },
    });
    presenceTest.register(t);
    const { alice, bob, definitions } = await seed(t);
    const copy = await addCopy(t, "bob", definitions[0], true);
    await settleDueJobs(t);
    // Alice follows twice the cap: first someone with older activity, then quiet members, then
    // bob, most recently.
    const early = await addMallory(t);
    await follow(t, alice, early);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityEntries", {
        actorId: early,
        kind: "completion",
        ref: "early-solve",
        occurredAt: Date.now() - HOUR,
      });
      for (let i = 0; i < 2 * FEED_MAX_AUDIENCE; i++) {
        const quiet = await ctx.db.insert("users", {
          clerkId: `clerk_quiet_${i}`,
          name: `quiet ${i}`,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("follows", {
          followerId: alice,
          followeeId: quiet,
          createdAt: Date.now(),
        });
      }
    });
    await follow(t, alice, bob);
    await setReady(t, true);

    const feed = await feedOf(t, "alice");
    expect(refsOf(feed, "acquisition")).toEqual([copy]);
    // The member followed longest ago falls outside the merge.
    expect(refsOf(feed, "completion")).toEqual([]);
  });

  test("the limit is clamped to 1..50 on both paths", async () => {
    const t = newT();
    const { alice } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        const occurredAt = Date.now() - i * 1000;
        await ctx.db.insert("domainEvents", {
          name: "CompletionRecorded",
          payload: { userId: alice, completionId: `c-${i}` },
          occurredAt,
          context: "test",
          processedAt: occurredAt,
        });
      }
    });
    await runBackfill(t);

    for (const [limit, expected] of [
      [1000, 50],
      [0, 1],
      [-5, 1],
      [2.7, 2],
    ]) {
      const feed = await compareBothWays(t, "alice", limit);
      expect(feed).toHaveLength(expected);
    }
    expect(await compareBothWays(t, "alice")).toHaveLength(50);
  });
});

describe("activity feed — the projection shows what the legacy read showed", () => {
  test("single adds: a follower sees the open ones, the owner all", async () => {
    const t = newT();
    const { alice, bob, definitions } = await seed(t);
    await follow(t, bob, alice);
    const open = await addCopy(t, "alice", definitions[0], true);
    const closed = await addCopy(t, "alice", definitions[1], false);

    expect(refsOf(await feedBothWays(t, "bob"), "acquisition")).toEqual([open]);
    expect(
      refsOf(await feedBothWays(t, "alice"), "acquisition").sort(),
    ).toEqual([open, closed].sort());
  });

  test("a batch is one entry counting the copies the viewer may see, covers in pick order", async () => {
    const t = newT();
    const { alice, bob, definitions } = await seed(t);
    await follow(t, bob, alice);
    const { copyIds } = await asUser(t, "alice").mutation(
      api.library.acquireCopies.acquireCopies,
      {
        items: definitions.slice(0, 5).map((puzzleDefinitionId, index) => ({
          puzzleDefinitionId,
          forTrade: index < 2,
        })),
      },
    );

    const [theirs] = (await feedBothWays(t, "bob")).filter(
      (e) => e.kind === "acquisitionBatch",
    );
    expect(theirs.batch?.count).toBe(2);
    expect(theirs.batch?.covers.map((c) => c.copyId)).toEqual(
      copyIds.slice(0, 2),
    );
    const mine = (await feedBothWays(t, "alice")).filter(
      (e) => e.kind === "acquisitionBatch",
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].batch?.count).toBe(5);
    expect(mine[0].batch?.covers.map((c) => c.copyId)).toEqual(
      copyIds.slice(0, 4),
    );
  });

  test("dated solves show; year-only and past-solves batches never do", async () => {
    const t = newT();
    const { alice, bob, definitions } = await seed(t);
    await follow(t, bob, alice);
    const copy = await addCopy(t, "alice", definitions[0], true);
    const { completionId: dated } = await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copy,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    );
    await asUser(t, "alice").mutation(
      api.solving.recordCompletion.recordCompletion,
      { copyId: copy, datePrecision: "year", year: 2020 },
    );
    await asUser(t, "alice").mutation(
      api.solving.recordPastCompletions.recordPastCompletions,
      {
        items: [{ copyId: copy, datePrecision: "day", date: Date.now() - DAY }],
      },
    );

    for (const viewer of ["bob", "alice"]) {
      expect(refsOf(await feedBothWays(t, viewer), "completion")).toEqual([
        dated,
      ]);
    }
  });

  test("a start shows to mutual followers of an opted-in actor, once its day has come", async () => {
    const t = newT();
    const { alice, bob, definitions } = await seed(t);
    await follow(t, bob, alice);
    const copy = await addCopy(t, "alice", definitions[0], true);
    const past = await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copy, startDate: Date.now() - HOUR },
    );
    const future = await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copy, startDate: Date.now() + DAY },
    );

    // Not opted in.
    expect(refsOf(await feedBothWays(t, "bob"), "started")).toEqual([]);
    // Opted in, but Bob only follows Alice one way.
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    expect(refsOf(await feedBothWays(t, "bob"), "started")).toEqual([]);
    // Mutual: the start that has begun shows, to Bob and to Alice herself.
    await follow(t, alice, bob);
    expect(refsOf(await feedBothWays(t, "bob"), "started")).toEqual([past]);
    expect(refsOf(await feedBothWays(t, "alice"), "started")).toEqual([past]);

    // Two days on, the other start has begun too.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * DAY);
    expect(refsOf(await compareBothWays(t, "bob"), "started").sort()).toEqual(
      [past, future].sort(),
    );
  });

  test("pages stay full when newer entries are gated out", async () => {
    const t = newT();
    const { alice, bob, carol, definitions } = await seed(t);
    // Bob follows Carol one way (she never opts in) and is mutual with opted-in Alice.
    await follow(t, bob, carol);
    await follow(t, bob, alice);
    await follow(t, alice, bob);
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    // Their copies, seeded without an acquisition entry: only starts are in the feed.
    const [alicesCopy, carolsCopy] = await t.run(async (ctx) => {
      const puzzleId = (await ctx.db.query("puzzles").first())!._id;
      return Promise.all(
        [alice, carol].map(async (ownerId) => {
          const aggregateId = crypto.randomUUID();
          await ctx.db.insert("ownedPuzzles", {
            aggregateId,
            puzzleDefinitionId: definitions[0],
            puzzleId,
            ownerId,
            condition: "good",
            availability: { forTrade: false, forSale: false, forLend: false },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return aggregateId;
        }),
      );
    });
    const start = (who: string, copyId: string, at: number) =>
      asUser(t, who).mutation(api.solving.startCompletion.startCompletion, {
        copyId,
        startDate: at,
      });
    for (const hours of [5, 4, 3]) {
      await start("alice", alicesCopy, Date.now() - hours * HOUR);
    }
    // Carol's two starts are the newest entries in Bob's feed, and both are hidden from him.
    await start("carol", carolsCopy, Date.now() - 2 * HOUR);
    await start("carol", carolsCopy, Date.now() - HOUR);
    await settleDueJobs(t);
    // One millisecond apart, in the order they were logged, in the log and in the read model, so
    // the page boundary is unambiguous.
    await t.run(async (ctx) => {
      const base = Date.now() - 10_000;
      const events = await ctx.db
        .query("domainEvents")
        .withIndex("by_name", (q) => q.eq("name", "CompletionStarted"))
        .collect();
      const rows = await ctx.db.query("activityEntries").collect();
      for (const [i, event] of events.entries()) {
        const ref = (event.payload as { completionId: string }).completionId;
        const row = rows.find((r) => r.kind === "started" && r.ref === ref)!;
        await ctx.db.patch(event._id, { occurredAt: base + i });
        await ctx.db.patch(row._id, { occurredAt: base + i });
      }
    });

    const feed = await compareBothWays(t, "bob", 3);
    expect(feed.map((e) => [e.kind, e.memberId])).toEqual([
      ["started", alice],
      ["started", alice],
      ["started", alice],
    ]);
  });

  test("an exchange shows once, under its initiator, and links only a party", async () => {
    const t = newT();
    const { alice, bob, carol, puzzleIds } = await seed(t);
    await follow(t, bob, alice);
    await follow(t, carol, alice);
    const byAlice = await completeExchange(t, alice, bob, puzzleIds[5]);
    const byBob = await completeExchange(
      t,
      bob,
      alice,
      puzzleIds[4],
      Date.now() - HOUR,
    );

    const exchanges = async (viewer: string) =>
      (await feedBothWays(t, viewer))
        .filter((e) => e.kind === "exchange")
        .map((e) => [e.ref, e.memberId, e.target]);
    expect(await exchanges("bob")).toEqual([
      [byAlice, alice, { kind: "trades" }],
      [byBob, bob, { kind: "trades" }],
    ]);
    // Carol follows only Alice and is no party.
    expect(await exchanges("carol")).toEqual([
      [byAlice, alice, undefined],
      [byBob, alice, undefined],
    ]);
  });

  test("a private member's entries need the profile unlock, and a viewer's own side of their exchange survives (SEC-43)", async () => {
    const t = newT();
    const { alice, bob, carol, definitions, puzzleIds } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        memberId: alice,
        visibility: "private",
        updatedAt: Date.now(),
      });
    });
    await follow(t, bob, alice);
    await follow(t, carol, alice);
    await follow(t, carol, bob);
    const trade = await completeExchange(t, alice, bob, puzzleIds[5]);
    await addCopy(t, "alice", definitions[0], true);

    const entries = async (viewer: string) =>
      (await feedBothWays(t, viewer)).map((e) => [
        e.kind,
        e.ref,
        e.memberId,
        e.target,
      ]);
    // Bob follows Alice one way: only his own side of their trade, under himself.
    expect(await entries("bob")).toEqual([
      ["exchange", trade, bob, { kind: "trades" }],
    ]);
    // Carol follows both and is no party: it shows under the party she may see.
    expect(await entries("carol")).toEqual([
      ["exchange", trade, bob, undefined],
    ]);
    // Mutual following unlocks Alice: the trade is back under its initiator.
    await follow(t, alice, bob);
    expect(
      (await entries("bob")).filter(([kind]) => kind === "exchange"),
    ).toEqual([["exchange", trade, alice, { kind: "trades" }]]);
  });

  test("a blocked actor drops out", async () => {
    const t = newT();
    const { alice, bob, carol, definitions } = await seed(t);
    await follow(t, bob, alice);
    await follow(t, bob, carol);
    await addCopy(t, "alice", definitions[0], true);
    const carols = await addCopy(t, "carol", definitions[1], true);
    await t.run(async (ctx) => {
      await ctx.db.insert("blocks", {
        blockerId: alice,
        blockedId: bob,
        createdAt: Date.now(),
      });
    });

    const feed = await feedBothWays(t, "bob");
    expect(feed.map((e) => e.memberId)).toEqual([carol]);
    expect(refsOf(feed, "acquisition")).toEqual([carols]);
  });

  test("deleted and transferred copies drop out of their acquisition", async () => {
    const t = newT();
    const { alice, bob, carol, definitions } = await seed(t);
    await follow(t, bob, alice);
    const single = await addCopy(t, "alice", definitions[0], true);
    const { copyIds } = await asUser(t, "alice").mutation(
      api.library.acquireCopies.acquireCopies,
      {
        items: definitions.slice(1, 4).map((puzzleDefinitionId) => ({
          puzzleDefinitionId,
          forTrade: true,
        })),
      },
    );
    await t.run(async (ctx) => {
      const row = (aggregateId: string) =>
        ctx.db
          .query("ownedPuzzles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
          .unique();
      await ctx.db.delete((await row(single))!._id);
      await ctx.db.patch((await row(copyIds[0]))!._id, { ownerId: carol });
    });

    const feed = await feedBothWays(t, "bob");
    expect(refsOf(feed, "acquisition")).toEqual([]);
    const [batch] = feed.filter((e) => e.kind === "acquisitionBatch");
    expect(batch.batch?.count).toBe(2);
    expect(batch.batch?.covers.map((c) => c.copyId)).toEqual(copyIds.slice(1));
  });
});
