import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EVENT_SCRUB_DELAY_MS } from "./conversation/purgeMemberMessagingData";
import schema from "./schema";

// conversation/backfillDeletedMemberData: for accounts deleted before the purge covered their
// library, it finds the member ids behind the rows the later purge phases clean up (exchanges,
// loans, copies, photos, completions, goals, collections, categories, circles, household seats)
// whose users row is gone or inactive. A dry run (the default) only reports them; a real run purges them from the
// exchangesOpen phase on.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

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

// The ids the run's last batch reports.
const reportedIds = (): string[] => {
  const last = logs.filter((line) =>
    line.startsWith("conversation/backfillDeletedMemberData"),
  );
  const json = last[last.length - 1].slice(last[last.length - 1].indexOf("{"));
  return (JSON.parse(json) as { found: string[] }).found;
};

// Alice was hard-deleted (no users row) and left two copies; Dave is tombstoned (inactive) and
// still owns a circle Bob is in; Erin was hard-deleted and still sits in Bob's household; Fred
// was hard-deleted and left only a goal and an open loan of Bob's copy; Gina was hard-deleted and
// left only an event in the log. Bob is active and has a copy of his own.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: string, isActive = true) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        name: who,
        isActive,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mk("alice");
    const bob = await mk("bob");
    const dave = await mk("dave", false);
    const erin = await mk("erin");
    const fred = await mk("fred");
    const gina = await mk("gina");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const copy = (ownerId: Id<"users">, aggregateId: string) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
    await copy(alice, "copy-a1");
    await copy(alice, "copy-a2");
    const bobsCopy = await copy(bob, "copy-b1");
    await ctx.db.insert("goals", {
      userId: fred,
      title: "Ten this year",
      targetCompletions: 10,
      currentCompletions: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("loans", {
      aggregateId: "loan-f",
      copyId: "copy-b1",
      lenderId: bob,
      borrowerId: fred,
      status: "open",
      openedAt: now,
    });
    await ctx.db.insert("circles", {
      aggregateId: "circle-d",
      ownerId: dave,
      name: "Dave's circle",
      memberships: [
        { id: "m1", memberId: dave, permission: "Admin", joinedAt: now - 2 },
        { id: "m2", memberId: bob, permission: "ViewOnly", joinedAt: now - 1 },
      ],
      createdAt: now,
    });
    for (const memberId of [dave, bob]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-d",
        memberId,
      });
    }
    await ctx.db.insert("households", { aggregateId: "hh-1", createdAt: now });
    await ctx.db.insert("householdMembers", {
      householdId: "hh-1",
      memberId: bob,
      role: "admin",
      joinedAt: now - 2,
    });
    await ctx.db.insert("householdMembers", {
      householdId: "hh-1",
      memberId: erin,
      role: "member",
      joinedAt: now - 1,
    });
    await ctx.db.delete(alice);
    await ctx.db.delete(erin);
    await ctx.db.insert("domainEvents", {
      name: "MemberRegistered",
      payload: { memberId: gina, clerkId: "clerk_gina", email: "g@x.test" },
      context: "identity",
      occurredAt: now,
      processedAt: now,
    });
    await ctx.db.delete(fred);
    await ctx.db.delete(gina);
    return { alice, bob, dave, erin, fred, gina, bobsCopy };
  });

const snapshot = (t: T) =>
  t.run(async (ctx) => ({
    copies: (await ctx.db.query("ownedPuzzles").collect()).map(
      (c) => c.ownerId,
    ),
    circles: (await ctx.db.query("circles").collect()).map((c) => c.ownerId),
    seats: (await ctx.db.query("householdMembers").collect()).map(
      (m) => m.memberId,
    ),
    goals: (await ctx.db.query("goals").collect()).map((g) => g.userId),
    loans: (await ctx.db.query("loans").collect()).map((l) => l.status),
    events: (await ctx.db.query("domainEvents").collect()).map(
      (e) => e.payload,
    ),
  }));

describe("conversation.backfillDeletedMemberData", () => {
  test("a dry run (the default) reports the departed ids and changes nothing", async () => {
    const t = newT();
    const s = await seed(t);
    const before = await snapshot(t);

    await t.mutation(
      internal.conversation.backfillDeletedMemberData.backfillDeletedMemberData,
      { batchSize: 1 },
    );
    await settleDueJobs(t);

    expect(await snapshot(t)).toEqual(before);
    expect(reportedIds().sort()).toEqual(
      [s.alice, s.dave, s.erin, s.fred, s.gina].sort(),
    );
    // Nothing was scheduled beyond the backfill's own batches.
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.filter((job) => job.name.includes("purgeMemberMessagingData")),
    ).toEqual([]);
  });

  test("a real run purges them, each once, and leaves active members alone", async () => {
    const t = newT();
    const s = await seed(t);

    await t.mutation(
      internal.conversation.backfillDeletedMemberData.backfillDeletedMemberData,
      { dryRun: false, batchSize: 1 },
    );
    await settleDueJobs(t);
    expect(await runDelayedScrubs(t)).toBe(5);

    const purges = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter(
      (job) =>
        job.name.includes("purgeMemberMessagingData") &&
        job.args[0].phase === "exchangesOpen",
    );
    expect(purges.map((job) => job.args[0].memberId).sort()).toEqual(
      [s.alice, s.dave, s.erin, s.fred, s.gina].sort(),
    );

    const after = await snapshot(t);
    // Alice's copies are gone, Bob's stays.
    expect(after.copies).toEqual([s.bob]);
    // Dave's circle went to Bob; Erin left Bob's household.
    expect(after.circles).toEqual([s.bob]);
    expect(after.seats).toEqual([s.bob]);
    // Fred's goal is gone and the copy he borrowed is back with Bob.
    expect(after.goals).toEqual([]);
    expect(after.loans).toEqual(["returned"]);
    // Gina's event no longer names her, nor does the event of Erin leaving the household (emitted
    // by her own purge, scrubbed once it was dispatched).
    expect(after.events).toEqual([
      { memberId: "deleted-member" },
      { householdId: "hh-1", memberId: "deleted-member" },
    ]);
  });
});

describe("conversation.backfillDeletedMemberData: events keyed by a deleted copy", () => {
  // An earlier deletion removed Hana's copy but left its CopyDetailsUpdated (no member id, her
  // notes) in the log. Bob's copy still exists.
  const seedCopyEvents = (t: T) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const bob = await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        name: "bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: bob,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy-b1",
        puzzleId,
        ownerId: bob,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      const event = (copyId: string, notes: string) =>
        ctx.db.insert("domainEvents", {
          name: "CopyDetailsUpdated",
          payload: { copyId, missingPiecesCount: 1, notes },
          context: "library",
          occurredAt: now,
          processedAt: now,
        });
      return {
        hanas: await event("copy-h1", "from my gran"),
        bobs: await event("copy-b1", "Bob's note"),
      };
    });

  const run = async (t: T, dryRun: boolean) => {
    await t.mutation(
      internal.conversation.backfillDeletedMemberData.backfillDeletedMemberData,
      { dryRun, table: "domainEvents", batchSize: 1 },
    );
    await settleDueJobs(t);
  };

  const deletedCopyEventsLogged = () =>
    logs
      .filter((line) =>
        line.startsWith("conversation/backfillDeletedMemberData"),
      )
      .map(
        (line) =>
          (
            JSON.parse(line.slice(line.indexOf("{"))) as {
              deletedCopyEvents?: number;
            }
          ).deletedCopyEvents ?? 0,
      )
      .reduce((a, b) => a + b, 0);

  test("a dry run counts the event and changes nothing", async () => {
    const t = newT();
    const e = await seedCopyEvents(t);
    await run(t, true);
    expect(deletedCopyEventsLogged()).toBe(1);
    expect(
      await t.run(async (ctx) => (await ctx.db.get(e.hanas))!.payload),
    ).toEqual({
      copyId: "copy-h1",
      missingPiecesCount: 1,
      notes: "from my gran",
    });
  });

  test("a real run drops the deleted copy's notes and keeps Bob's", async () => {
    const t = newT();
    const e = await seedCopyEvents(t);
    await run(t, false);
    expect(deletedCopyEventsLogged()).toBe(1);
    const payloads = await t.run(async (ctx) => ({
      hanas: (await ctx.db.get(e.hanas))!.payload,
      bobs: (await ctx.db.get(e.bobs))!.payload,
    }));
    expect(payloads).toEqual({
      hanas: { copyId: "copy-h1", missingPiecesCount: 1 },
      bobs: { copyId: "copy-b1", missingPiecesCount: 1, notes: "Bob's note" },
    });
  });
});
