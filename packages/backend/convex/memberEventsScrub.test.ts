import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  scrubDeletedCopyEvent,
  scrubPayload,
} from "./conversation/purgeMemberEvents";
import { EVENT_SCRUB_DELAY_MS } from "./conversation/purgeMemberMessagingData";
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
        await insertEvent(t, "CopyAcquired", {
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
