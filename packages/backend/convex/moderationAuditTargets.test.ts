import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-57: a moderation audit row that targets a member (a report decision, a role change) stores
// the member's id, never their name or email. The admin read models resolve the label while the
// account exists and read "Deleted member" once it is gone. Older rows are rewritten by
// admin/backfillAuditTargets.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

// Fake timers: decideReport schedules the 12-month retention purge; nothing scheduled runs unless
// a test advances the clock.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Strings that identify Bob (name, email, Clerk id) and a member whose account is already gone.
const BOB_NAME = "Bob Builder";
const BOB_EMAIL = "bob.builder@example.com";
const BOB_CLERK = "clerk_bob";
const GONE_NAME = "Gina Gone";
const GONE_CLERK = "clerk_gina";
const PII = [BOB_NAME, BOB_EMAIL, BOB_CLERK, GONE_NAME, GONE_CLERK];

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "Alice", "alice@example.com");
    const bob = await mkUser(BOB_CLERK, BOB_NAME, BOB_EMAIL);
    const ada = await mkUser("clerk_ada", "Ada Admin", "ada@example.com");
    return { alice, bob, ada };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const allActions = (t: T) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

// Convex sorts keys and drops undefined on write: compare the stored row as canonical JSON.
const storedText = (row: Doc<"moderationActions">) => JSON.stringify(row);

const expectNoPii = (rows: Doc<"moderationActions">[]) => {
  for (const row of rows) {
    for (const value of PII) expect(storedText(row)).not.toContain(value);
  }
};

const warnBob = async (t: T, bob: Id<"users">) => {
  const { reportId } = await asAlice(t).mutation(
    api.reports.fileReport.fileReport,
    { targetKind: "user", targetId: bob, reason: "harassment_hate" },
  );
  await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
    reportId,
    decision: "warned",
    statementOfReasons: "Rude",
  });
  return reportId;
};

const activity = async (t: T) => {
  const { page } = await asAdmin(t).query(
    api.admin.getModerationActivity.getModerationActivity,
    { paginationOpts: { numItems: 100, cursor: null } },
  );
  return page;
};

describe("member-targeted audit stamps", () => {
  test("a report decision stores the reported member's id and a neutral label", async () => {
    const t = convexTest(schema, modules);
    const { bob, ada } = await seed(t);
    const reportId = await warnBob(t, bob);

    const rows = await allActions(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ada,
      kind: "report_warned",
      targetMemberId: bob,
      targetId: reportId,
    });
    expectNoPii(rows);
  });

  test("a role change stores the member's id as target, not their Clerk id or name", async () => {
    const t = convexTest(schema, modules);
    const { bob, ada } = await seed(t);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: "admin",
      actorId: ada,
    });

    const rows = await allActions(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ada,
      kind: "role_granted",
      targetMemberId: bob,
      targetId: bob,
    });
    expectNoPii(rows);
  });

  test("the activity log names the member live, and 'Deleted member' once the account is gone", async () => {
    const t = convexTest(schema, modules);
    const { bob, ada } = await seed(t);
    await warnBob(t, bob);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: ada,
    });

    const before = await activity(t);
    expect(before.map((row) => [row.kind, row.targetLabel])).toEqual([
      ["role_revoked", BOB_NAME],
      ["report_warned", BOB_NAME],
    ]);
    expect(before.every((row) => row.targetMemberDeleted === undefined)).toBe(
      true,
    );
    // A role row links the member through targetMemberId (its targetId is no Clerk id any more).
    expect(before[0]?.target).toEqual({ kind: "member", userId: bob });
    expect(before[1]?.target).toMatchObject({ kind: "report" });

    const stored = await allActions(t);
    // The account purge never touches moderationActions: the users row going is what the read
    // model sees.
    await t.run((ctx) => ctx.db.delete(bob));

    const after = await activity(t);
    expect(
      after.map((row) => [row.kind, row.targetLabel, row.targetMemberDeleted]),
    ).toEqual([
      ["role_revoked", "Deleted member", true],
      ["report_warned", "Deleted member", true],
    ]);
    // A member link with no member left is plain text; the report itself still has its page.
    expect(after[0]?.target).toBeNull();
    expect(after[1]?.target).toMatchObject({ kind: "report" });
    expect(await allActions(t)).toEqual(stored);
    expectNoPii(await allActions(t));
  });

  test("a definition row keeps its stored title as the label", async () => {
    const t = convexTest(schema, modules);
    const { ada } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("moderationActions", {
        actorId: ada,
        kind: "definition_approved",
        targetLabel: "Member",
        targetId: "def-1",
        at: Date.now(),
      }),
    );
    const [row] = await activity(t);
    expect(row).toEqual({
      actionId: expect.any(String),
      kind: "definition_approved",
      actorId: ada,
      actorName: "Ada Admin",
      targetLabel: "Member",
      targetId: "def-1",
      target: null,
      at: expect.any(Number),
    });
  });
});

describe("admin/getUserDetail received trail", () => {
  test("merges rows keyed by member id with legacy rows keyed by Clerk id, newest first", async () => {
    const t = convexTest(schema, modules);
    const { bob, ada } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("moderationActions", {
        actorId: ada,
        kind: "role_granted",
        targetLabel: BOB_NAME,
        targetId: BOB_CLERK,
        at: Date.now() - 60_000,
      }),
    );
    await warnBob(t, bob);
    vi.advanceTimersByTime(1000);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: ada,
    });

    const detail = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(
      detail.audit.received.map((row) => [row.kind, row.targetLabel]),
    ).toEqual([
      ["role_revoked", BOB_NAME],
      ["report_warned", BOB_NAME],
      ["role_granted", BOB_NAME],
    ]);
  });

  test("caps the merged list at 20", async () => {
    const t = convexTest(schema, modules);
    const { bob, ada } = await seed(t);
    const base = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "role_granted",
          targetLabel: "Member",
          targetId: bob,
          targetMemberId: bob,
          at: base + i * 2,
        });
        await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "role_revoked",
          targetLabel: BOB_NAME,
          targetId: BOB_CLERK,
          at: base + i * 2 + 1,
        });
      }
    });
    const detail = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(detail.audit.received).toHaveLength(20);
    expect(detail.audit.received[0].at).toBe(base + 29);
    expect(detail.audit.received[19].at).toBe(base + 10);
  });
});

describe("admin/backfillAuditTargets", () => {
  // Legacy rows as stamped before SEC-57: names in targetLabel, the Clerk id as a role row's target.
  const seedLegacy = (t: T) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const mkUser = (clerkId: string, name: string, email: string) =>
        ctx.db.insert("users", {
          clerkId,
          email,
          name,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      const bob = await mkUser(BOB_CLERK, BOB_NAME, BOB_EMAIL);
      const ada = await mkUser("clerk_ada", "Ada Admin", "ada@example.com");
      const reportId = await ctx.db.insert("reports", {
        targetKind: "user",
        targetId: bob,
        reportedUserId: bob,
        reason: "spam_scam",
        evidence: {},
        status: "actioned",
        decision: "warned",
        decidedBy: ada,
        decidedAt: now,
        createdAt: now,
      });
      const legacy = {
        report: await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "report_warned",
          targetLabel: BOB_NAME,
          targetId: reportId,
          at: now - 4,
        }),
        role: await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "role_granted",
          targetLabel: BOB_EMAIL,
          targetId: BOB_CLERK,
          at: now - 3,
        }),
        // Gina's account was deleted before the backfill: no users row to link.
        departed: await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "role_revoked",
          targetLabel: GONE_NAME,
          targetId: GONE_CLERK,
          at: now - 2,
        }),
        definition: await ctx.db.insert("moderationActions", {
          actorId: ada,
          kind: "definition_approved",
          targetLabel: "Mountain Vista",
          targetId: "def-1",
          at: now - 1,
        }),
      };
      return { bob, ada, reportId, legacy };
    });

  const runBackfill = async (
    t: T,
    args: { dryRun?: boolean; batchSize?: number },
  ) => {
    await t.mutation(
      internal.admin.backfillAuditTargets.backfillAuditTargets,
      args,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };

  test("a dry run (the default) changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedLegacy(t);
    const before = await allActions(t);
    const counts = await t.mutation(
      internal.admin.backfillAuditTargets.backfillAuditTargets,
      {},
    );
    expect(counts).toEqual({ scanned: 4, linked: 2, departed: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await allActions(t)).toEqual(before);
  });

  test("links rows to the member, scrubs names, emails and Clerk ids, and leaves other rows alone", async () => {
    const t = convexTest(schema, modules);
    const { bob, reportId, legacy } = await seedLegacy(t);
    await runBackfill(t, { dryRun: false, batchSize: 1 });

    const byId = new Map((await allActions(t)).map((row) => [row._id, row]));
    expect(byId.get(legacy.report)).toMatchObject({
      targetMemberId: bob,
      targetId: reportId,
    });
    expect(byId.get(legacy.role)).toMatchObject({
      targetMemberId: bob,
      targetId: bob,
    });
    expect(byId.get(legacy.departed)?.targetMemberId).toBeUndefined();
    expect(byId.get(legacy.departed)?.targetId).toBe("deleted-member");
    expect(byId.get(legacy.definition)).toMatchObject({
      targetLabel: "Mountain Vista",
      targetId: "def-1",
    });
    expectNoPii([...byId.values()]);

    const rows = await activity(t);
    expect(
      rows.map((row) => [row.kind, row.targetLabel, row.targetMemberDeleted]),
    ).toEqual([
      ["definition_approved", "Mountain Vista", undefined],
      ["role_revoked", "Deleted member", true],
      ["role_granted", BOB_NAME, undefined],
      ["report_warned", BOB_NAME, undefined],
    ]);
  });

  test("is idempotent: a second run changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedLegacy(t);
    await runBackfill(t, { dryRun: false });
    const once = await allActions(t);
    const counts = await t.mutation(
      internal.admin.backfillAuditTargets.backfillAuditTargets,
      { dryRun: false },
    );
    expect(counts).toEqual({ scanned: 4, linked: 0, departed: 0 });
    expect(await allActions(t)).toEqual(once);
  });
});
