import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RETENTION_SWEEP_PAGE } from "./lib/retention";
import {
  OPEN_REPORT_ALERT_AFTER_MS,
  reportRetainUntil,
} from "./reports/retention";
import schema from "./schema";

// Report retention (spec 2.8): a decided report is purged 12 months after its decision, scheduled
// at the decision. The purge anonymises the reporter and clears the details and the evidence
// message bodies; the record of the decision stays. Fake timers keep the year-long schedule from
// firing (convex-test clamps an overflowing setTimeout to 1 ms).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const DECIDED_AT = Date.UTC(2026, 0, 15, 12);

beforeEach(() => {
  vi.useFakeTimers({ now: DECIDED_AT });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

const seedReport = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        preferredLanguage: "en",
        createdAt: 1,
        updatedAt: 1,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    await mkUser("clerk_ada");
    const reportId = await ctx.db.insert("reports", {
      reporterId: alice,
      targetKind: "message",
      targetId: "msg-2",
      reportedUserId: bob,
      reason: "illegal",
      details: "He threatened me",
      illegalNotice: {
        notifierName: "Alice A.",
        notifierEmail: "alice@elsewhere.test",
        goodFaith: true,
      },
      evidence: {
        messages: [
          {
            messageId: "msg-1",
            authorId: alice,
            kind: "text",
            body: "Where do we meet?",
            sentAt: 1,
          },
          {
            messageId: "msg-2",
            authorId: bob,
            kind: "text",
            body: "Something threatening",
            sentAt: 2,
          },
        ],
      },
      status: "open",
      createdAt: 1,
    });
    return { alice, bob, reportId };
  });

const decide = (t: T, reportId: Id<"reports">) =>
  asAdmin(t).mutation(api.admin.decideReport.decideReport, {
    reportId,
    decision: "warned",
    statementOfReasons: "Threats are not allowed.",
  });

describe("report retention", () => {
  test("twelve calendar months after the decision", () => {
    expect(new Date(reportRetainUntil(DECIDED_AT)).toISOString()).toBe(
      "2027-01-15T12:00:00.000Z",
    );
  });

  test("the decision schedules the purge for the end of the retention window", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedReport(t);
    await decide(t, reportId);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const purge = jobs.filter((job) => job.name.includes("retention"));
    expect(purge).toHaveLength(1);
    expect(purge[0].scheduledTime).toBe(reportRetainUntil(DECIDED_AT));
    expect(purge[0].args).toEqual([{ reportId }]);
  });

  test("the purge anonymises the reporter and clears details and evidence bodies", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, reportId } = await seedReport(t);
    await decide(t, reportId);
    vi.setSystemTime(reportRetainUntil(DECIDED_AT));
    await t.mutation(internal.reports.retention.purgeReport, { reportId });

    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report).not.toHaveProperty("reporterId");
    expect(report).not.toHaveProperty("details");
    expect(report).toMatchObject({
      reporterAnonymisedAt: expect.any(Number),
      retentionPurgedAt: expect.any(Number),
      illegalNotice: { goodFaith: true },
      reportedUserId: bob,
      status: "actioned",
      decision: "warned",
      statementOfReasons: "Threats are not allowed.",
      decidedAt: DECIDED_AT,
    });
    expect(report!.illegalNotice).toEqual({ goodFaith: true });
    expect(report!.evidence.messages).toEqual([
      {
        messageId: "msg-1",
        authorId: alice,
        kind: "text",
        body: "",
        sentAt: 1,
      },
      {
        messageId: "msg-2",
        authorId: bob,
        kind: "text",
        body: "",
        sentAt: 2,
      },
    ]);
  });

  test("the purge clears a reported comment's or review's snapshotted text", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedReport(t);
    const reportIds = await t.run(async (ctx) =>
      Promise.all(
        (["photoComment", "puzzleReview"] as const).map((targetKind) =>
          ctx.db.insert("reports", {
            reporterId: alice,
            targetKind,
            targetId: `${targetKind}-1`,
            reportedUserId: bob,
            reason: "harassment_hate",
            evidence: { text: "Something insulting" },
            status: "open",
            createdAt: 1,
          }),
        ),
      ),
    );
    vi.setSystemTime(DECIDED_AT);
    for (const reportId of reportIds) await decide(t, reportId);
    vi.setSystemTime(reportRetainUntil(DECIDED_AT));
    for (const reportId of reportIds) {
      await t.mutation(internal.reports.retention.purgeReport, { reportId });
      const report = await t.run((ctx) => ctx.db.get(reportId));
      expect(report!.evidence).toEqual({});
      expect(report).toMatchObject({
        retentionPurgedAt: expect.any(Number),
        decision: "warned",
      });
    }
  });

  test("before the window ends it only reschedules itself", async () => {
    const t = convexTest(schema, modules);
    const { alice, reportId } = await seedReport(t);
    await decide(t, reportId);
    vi.setSystemTime(reportRetainUntil(DECIDED_AT) - 1);
    await t.mutation(internal.reports.retention.purgeReport, { reportId });

    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report).toMatchObject({ reporterId: alice });
    expect(report).not.toHaveProperty("retentionPurgedAt");
    const pending = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter(
      (job) => job.name.includes("retention") && job.state.kind === "pending",
    );
    expect(pending).toHaveLength(2);
    expect(pending.map((job) => job.scheduledTime)).toEqual([
      reportRetainUntil(DECIDED_AT),
      reportRetainUntil(DECIDED_AT),
    ]);
  });

  test("an open report is never purged", async () => {
    const t = convexTest(schema, modules);
    const { alice, reportId } = await seedReport(t);
    vi.setSystemTime(reportRetainUntil(DECIDED_AT) + 1);
    await t.mutation(internal.reports.retention.purgeReport, { reportId });
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({
      reporterId: alice,
      details: "He threatened me",
      status: "open",
    });
  });
});

// The daily backstop (reports/retention.sweepReportRetention): a purge whose scheduled job was
// lost is re-armed, only when RETENTION_ENFORCE names "reports"; a dry run only counts. Open
// reports are never purged, only counted when overdue. Rows are inserted directly, so no job
// was ever scheduled for them: exactly the lost-job case.
describe("the retention backstop sweep", () => {
  const ONE_YEAR_LATER = reportRetainUntil(DECIDED_AT);

  // Every logged line, in order (info and error levels alike).
  let lines: string[] = [];
  const sweepEvents = () =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "retention.sweep");

  beforeEach(() => {
    lines = [];
    const capture = (line: unknown) => {
      lines.push(String(line));
    };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  const blobExists = (t: T, fileId: Id<"_storage">) =>
    t.run(async (ctx) => (await ctx.db.system.get(fileId)) !== null);

  const seedUsers = (t: T) =>
    t.run(async (ctx) => {
      const mkUser = (clerkId: string) =>
        ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.com`,
          name: clerkId,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        });
      return {
        alice: await mkUser("clerk_alice"),
        bob: await mkUser("clerk_bob"),
      };
    });

  const insertReport = (
    t: T,
    users: { alice: Id<"users">; bob: Id<"users"> },
    fields: {
      decidedAt?: number;
      createdAt?: number;
      evidenceFileId?: Id<"_storage">;
      evidenceRetainUntil?: number;
    },
  ) =>
    t.run((ctx) =>
      ctx.db.insert("reports", {
        reporterId: users.alice,
        targetKind: "user",
        targetId: users.bob,
        reportedUserId: users.bob,
        reason: "harassment_hate",
        details: "Rude messages",
        evidence: {},
        createdAt: fields.createdAt ?? DECIDED_AT - 1000,
        ...(fields.decidedAt === undefined
          ? { status: "open" as const }
          : {
              status: "actioned" as const,
              decision: "warned" as const,
              statementOfReasons: "Be kind.",
              decidedAt: fields.decidedAt,
            }),
        ...(fields.evidenceFileId && {
          evidenceFileId: fields.evidenceFileId,
          evidenceRetainUntil: fields.evidenceRetainUntil,
        }),
      }),
    );

  const sweep = async (t: T) => {
    await t.mutation(internal.reports.retention.sweepReportRetention, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };

  test("dry run (RETENTION_ENFORCE unset): a lost purge is counted, nothing changes", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const reportId = await insertReport(t, users, { decidedAt: DECIDED_AT });
    vi.setSystemTime(ONE_YEAR_LATER + 1);

    await sweep(t);

    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({
      reporterId: users.alice,
      details: "Rude messages",
    });
    expect(
      sweepEvents().map((e) => [e.phase, e.due, e.acted, e.dry_run]),
    ).toEqual([
      ["reports", 1, 0, true],
      ["evidence", 0, 0, true],
    ]);
  });

  test("enforced: a lost purge is re-armed and runs; a report inside its 12 months is left", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "reports");
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const lost = await insertReport(t, users, { decidedAt: DECIDED_AT });
    const recent = await insertReport(t, users, {
      decidedAt: DECIDED_AT + 30 * 24 * 60 * 60 * 1000,
    });
    vi.setSystemTime(ONE_YEAR_LATER + 1);

    await sweep(t);

    const purged = await t.run((ctx) => ctx.db.get(lost));
    expect(purged).not.toHaveProperty("reporterId");
    expect(purged).not.toHaveProperty("details");
    expect(purged).toMatchObject({ retentionPurgedAt: expect.any(Number) });
    expect(await t.run((ctx) => ctx.db.get(recent))).toMatchObject({
      reporterId: users.alice,
      details: "Rude messages",
    });
    expect(sweepEvents()[0]).toMatchObject({
      sweep: "reports",
      due: 1,
      acted: 1,
      dry_run: false,
    });
  });

  test("RETENTION_ENFORCE=all enforces it too; another sweep's name does not", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const reportId = await insertReport(t, users, { decidedAt: DECIDED_AT });
    vi.setSystemTime(ONE_YEAR_LATER + 1);

    vi.stubEnv("RETENTION_ENFORCE", "sentPhotos, copyPhotos");
    await sweep(t);
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({
      reporterId: users.alice,
    });

    vi.stubEnv("RETENTION_ENFORCE", "all");
    await sweep(t);
    expect(await t.run((ctx) => ctx.db.get(reportId))).not.toHaveProperty(
      "reporterId",
    );
  });

  test("an evidence copy past its 6 months is purged when enforced, kept in a dry run", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const evidenceFileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["evidence"])),
    );
    const reportId = await insertReport(t, users, {
      decidedAt: DECIDED_AT,
      evidenceFileId,
      evidenceRetainUntil: DECIDED_AT + 1000,
    });
    vi.setSystemTime(DECIDED_AT + 2000);

    await sweep(t);
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({
      evidenceFileId,
    });
    expect(await blobExists(t, evidenceFileId)).toBe(true);

    vi.stubEnv("RETENTION_ENFORCE", "reports");
    await sweep(t);
    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report).not.toHaveProperty("evidenceFileId");
    expect(report).not.toHaveProperty("evidenceRetainUntil");
    // The report itself is not due yet (decided 2 seconds ago).
    expect(report).toMatchObject({ reporterId: users.alice });
    expect(await blobExists(t, evidenceFileId)).toBe(false);
  });

  test("an evidence copy shared with a report whose date is later is left until then", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "reports");
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const evidenceFileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["evidence"])),
    );
    await insertReport(t, users, {
      decidedAt: DECIDED_AT,
      evidenceFileId,
      evidenceRetainUntil: DECIDED_AT + 1000,
    });
    await insertReport(t, users, {
      decidedAt: DECIDED_AT,
      evidenceFileId,
      evidenceRetainUntil: DECIDED_AT + 5000,
    });
    vi.setSystemTime(DECIDED_AT + 2000);

    await t.mutation(internal.reports.retention.sweepReportRetention, {});
    await t.finishInProgressScheduledFunctions();

    expect(await blobExists(t, evidenceFileId)).toBe(true);
    expect(sweepEvents().find((e) => e.phase === "evidence")).toBeUndefined();
  });

  test("open reports are never purged; those open over 30 days are counted at error level", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "all");
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const overdue = await insertReport(t, users, { createdAt: DECIDED_AT });
    await insertReport(t, users, {
      createdAt: DECIDED_AT + OPEN_REPORT_ALERT_AFTER_MS,
    });
    vi.setSystemTime(DECIDED_AT + OPEN_REPORT_ALERT_AFTER_MS + 1);

    await sweep(t);

    expect(await t.run((ctx) => ctx.db.get(overdue))).toMatchObject({
      status: "open",
      reporterId: users.alice,
      details: "Rude messages",
    });
    const [first] = sweepEvents();
    expect(first).toMatchObject({
      phase: "reports",
      outcome: "error",
      open_overdue: 1,
    });
  });

  test("pages past the page size: every lost purge in the backlog is re-armed", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "reports");
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const ids: Id<"reports">[] = [];
    for (let i = 0; i < RETENTION_SWEEP_PAGE + 5; i++) {
      ids.push(await insertReport(t, users, { decidedAt: DECIDED_AT + i }));
    }
    vi.setSystemTime(ONE_YEAR_LATER + 1000);

    await sweep(t);

    const rows = await t.run((ctx) =>
      Promise.all(ids.map((id) => ctx.db.get(id))),
    );
    expect(rows.every((row) => row?.retentionPurgedAt !== undefined)).toBe(
      true,
    );
    expect(
      sweepEvents()
        .filter((e) => e.phase === "reports")
        .map((e) => e.acted),
    ).toEqual([RETENTION_SWEEP_PAGE, 5]);
  });
});
