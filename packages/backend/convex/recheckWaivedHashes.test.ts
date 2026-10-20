import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { internal } from "./_generated/api";
import type {
  CsamHashCheckPort,
  CsamHashCheckResult,
} from "./lib/imageModeration/csamHashCheck";
import { hashRecheckPool } from "./lib/imageModeration/hashRecheckPool";
import schema from "./schema";

// The one-shot lib/imageModeration/recheckWaivedHashes: the CSAM hash check of photos an admin
// approved WITHOUT one after it timed out (`hashCheckWaivedBy` + kept `pendingHashes`), once the
// hash service is configured. Each candidate gets one re-check on the hash re-check Workpool; a
// match quarantines and escalates over the approval, a no_match is recorded and clears the waiver.
//
// The hash service is a FAKE PORT answering from `hcs.replies`, then `hcs.fallback`.

const hcs = vi.hoisted(() => ({
  replies: [] as CsamHashCheckResult["status"][],
  fallback: "no_match" as CsamHashCheckResult["status"],
  checks: 0,
}));

vi.mock("./lib/imageModeration/csamHashCheck", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./lib/imageModeration/csamHashCheck")
    >();
  const fakePort: CsamHashCheckPort = {
    provider: "offlimits",
    check: async () => {
      hcs.checks += 1;
      const status = hcs.replies.shift() ?? hcs.fallback;
      return status === "unavailable"
        ? { status, reason: "http_503" }
        : { status };
    },
  };
  return { ...actual, makeCsamHashCheckPortFromEnv: () => fakePort };
});

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  hcs.replies = [];
  hcs.fallback = "no_match";
  hcs.checks = 0;
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const configureHashService = () => {
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", "https://hcs.example.test");
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "user");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "secret");
};

const runEvents = () =>
  logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === "imageModeration.recheckWaivedHashes");

const HASHES = [
  { md5: "a".repeat(32), sha1: "b".repeat(40) },
  { md5: "c".repeat(32), sha1: "d".repeat(40) },
];

type Kind = "waived" | "checked" | "quarantined";

// One photo of each table: approved without a hash check by an admin ("waived"), an ordinary
// hash-checked one ("checked"), or a waived one a later match already quarantined.
const seed = (t: T, kind: Kind) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser(`clerk_alice_${crypto.randomUUID()}`);
    const admin = await mkUser(`clerk_admin_${crypto.randomUUID()}`);
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const blob = () =>
      ctx.storage.store(
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
      );
    const since = now - 8 * 24 * 60 * 60_000;
    const fields = {
      moderationStatus:
        kind === "quarantined"
          ? ("quarantined" as const)
          : ("approved" as const),
      moderatedBy: admin,
      reencodedAt: since,
      hashCheckedAt: since + 1,
      ...(kind === "checked"
        ? {}
        : {
            hashCheckWaivedBy: admin,
            pendingHashes: HASHES,
            hashCheckTimedOutAt: since,
            hashRecheckAttempt: 9,
          }),
    };
    const copyPhoto = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId: await blob(),
      ...fields,
      createdAt: since,
      updatedAt: since,
    });
    const completionPhoto = await ctx.db.insert("completionImages", {
      completionId: crypto.randomUUID(),
      uploaderId: alice,
      fileId: await blob(),
      ...fields,
      createdAt: since,
      updatedAt: since,
    });
    const boxArt = await ctx.db.insert("boxArtUploads", {
      storageId: await blob(),
      uploaderId: alice,
      ...fields,
      createdAt: since,
    });
    const messagePhoto = await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: crypto.randomUUID(),
      uploaderId: alice,
      fileId: await blob(),
      byteSize: 4,
      contentType: "image/jpeg",
      sendRequestedAt: since,
      sendIndex: 0,
      messageId: crypto.randomUUID(),
      ...fields,
      createdAt: since,
      updatedAt: since,
    });
    return { admin, copyPhoto, completionPhoto, boxArt, messagePhoto };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const rowsOf = (t: T, s: Seeded) =>
  t.run(async (ctx) => ({
    copy: await ctx.db.get(s.copyPhoto),
    completion: await ctx.db.get(s.completionPhoto),
    boxArt: await ctx.db.get(s.boxArt),
    message: await ctx.db
      .get(s.messagePhoto)
      .then((row) => (row?.kind === "image" ? row : null)),
  }));

const run = (
  t: T,
  args: {
    dryRun?: boolean;
    table?: "copy" | "completion" | "boxArt" | "message";
    batchSize?: number;
  } = {},
) =>
  t.mutation(
    internal.lib.imageModeration.recheckWaivedHashes.recheckWaivedHashes,
    args,
  );

const lastRun = () => runEvents().slice(-1)[0];

describe("the dry run (the default)", () => {
  test("counts the waived photos of every table, enqueues nothing and never calls the hash service, even unconfigured", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");
    await seed(t, "checked");
    await seed(t, "quarantined");
    const before = await rowsOf(t, waived);
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await run(t, { batchSize: 2 });
    await settleDueScheduled(t);

    expect(lastRun()).toMatchObject({
      dry_run: true,
      done: true,
      csam_hashcheck_provider: "none",
      scanned: 12,
      waived: 4,
      enqueued: 0,
    });
    expect(enqueued).not.toHaveBeenCalled();
    expect(hcs.checks).toBe(0);
    expect(await rowsOf(t, waived)).toEqual(before);
  });
});

describe("a real run", () => {
  test("refuses to start when the hash check is not configured", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t, "waived");
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await expect(run(t, { dryRun: false })).rejects.toThrow(
      "CSAM hash check not configured (disabled)",
    );
    vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
    await expect(run(t, { dryRun: false })).rejects.toThrow(
      "CSAM hash check not configured (missing_config)",
    );
    expect(enqueued).not.toHaveBeenCalled();
  });

  test("no_match records the check on every table's waived photo and clears the waiver, so a second run finds nothing", async () => {
    configureHashService();
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");
    const checked = await seed(t, "checked");
    const checkedBefore = await rowsOf(t, checked);
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await run(t, { dryRun: false });
    await settleDueScheduled(t);

    expect(enqueued).toHaveBeenCalledTimes(4);
    expect(lastRun()).toMatchObject({
      dry_run: false,
      done: true,
      waived: 4,
      enqueued: 4,
    });
    // Original and re-encode of each photo.
    expect(hcs.checks).toBe(8);
    for (const row of Object.values(await rowsOf(t, waived))) {
      expect(row).toMatchObject({ moderationStatus: "approved" });
      expect(row?.hashCheckedAt).toBeGreaterThan(Date.now() - 60_000);
      expect(row?.pendingHashes).toBeUndefined();
      expect(row?.hashCheckWaivedBy).toBeUndefined();
    }
    expect(await rowsOf(t, checked)).toEqual(checkedBefore);
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([]);

    await run(t);
    await settleDueScheduled(t);
    expect(lastRun()).toMatchObject({ dry_run: true, waived: 0 });
  });

  test("a match quarantines and escalates over the admin's approval, like a live match", async () => {
    configureHashService();
    hcs.fallback = "match";
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");

    await run(t, { dryRun: false });
    await settleDueScheduled(t);

    for (const row of Object.values(await rowsOf(t, waived))) {
      expect(row?.moderationStatus).toBe("quarantined");
      expect(row?.pendingHashes).toBeUndefined();
    }
    const escalations = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    expect(escalations.map((e) => e.table).sort()).toEqual([
      "boxArtUploads",
      "completionImages",
      "messageAttachments",
      "ownedPuzzleImages",
    ]);
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps.filter((s) => s.kind === "image_quarantined")).toHaveLength(
      4,
    );

    await run(t);
    await settleDueScheduled(t);
    expect(lastRun()).toMatchObject({ waived: 0 });
  });

  test("unavailable changes nothing and arms nothing more: the photo stays a candidate for the next run", async () => {
    configureHashService();
    hcs.fallback = "unavailable";
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await run(t, { dryRun: false, table: "copy" });
    await settleDueScheduled(t);

    expect(enqueued).toHaveBeenCalledTimes(1);
    const { copy } = await rowsOf(t, waived);
    expect(copy).toMatchObject({
      moderationStatus: "approved",
      pendingHashes: HASHES,
      hashCheckWaivedBy: waived.admin,
      hashRecheckAttempt: 10,
    });

    await run(t, { table: "copy" });
    await settleDueScheduled(t);
    expect(lastRun()).toMatchObject({ table: "copy", done: true, waived: 1 });
  });

  test("`table` limits the run to that table", async () => {
    configureHashService();
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");

    await run(t, { dryRun: false, table: "message" });
    await settleDueScheduled(t);

    const rows = await rowsOf(t, waived);
    expect(rows.message?.hashCheckWaivedBy).toBeUndefined();
    expect(rows.copy?.hashCheckWaivedBy).toEqual(waived.admin);
    expect(runEvents().map((e) => [e.table, e.waived, e.done])).toEqual([
      ["message", 1, true],
    ]);
  });

  test("a re-check of a waived photo is skipped when the service is unconfigured by then: the stored hashes stay", async () => {
    configureHashService();
    const t = withModerationPool(convexTest(schema, modules));
    const waived = await seed(t, "waived");
    await run(t, { dryRun: false, table: "copy" });
    // The service is switched off before the queued job runs.
    vi.unstubAllEnvs();
    vi.stubEnv("AXIOM_API_KEY", "");
    await settleDueScheduled(t);

    expect(hcs.checks).toBe(0);
    const { copy } = await rowsOf(t, waived);
    expect(copy).toMatchObject({
      pendingHashes: HASHES,
      hashCheckWaivedBy: waived.admin,
    });
    expect(
      logs.some((line) => line.includes('"result":"skipped_unconfigured"')),
    ).toBe(true);
  });
});
