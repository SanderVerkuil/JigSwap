import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportRetainUntil } from "./reports/retention";
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
