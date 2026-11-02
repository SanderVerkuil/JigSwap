import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import {
  allRenditions,
  backfillDoneEvent,
  blobCount,
  blobExists,
  blobType,
  jpeg,
  scheduledRenditions,
  settleRenditions,
  storeBytes,
  storeWebp,
  urlOf,
} from "../test-fixtures/renditionJobs";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { enqueueImageModeration } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// Circle icon renditions (PERF-C1, P-42): an icon is only ever a small avatar, so once it may be
// served it gets ONE small WebP, in the generic `imageRenditions` table, and `iconUrl` becomes
// that rendition. It goes with the icon: a newer icon, a removal, the circle's purge, a rejection
// and a quarantine all delete it. Non-members get no URL of either. HCS and the classifier are a
// routed fake `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type T = TestConvex<typeof schema>;
type Who = "alice" | "carol" | "dave" | "erin";

const routedFetch = (hcs: "match" | "no_match" | number, nsfw = 0.01) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === HCS_URL) {
      if (typeof hcs === "number") {
        return new Response("unavailable", { status: hcs });
      }
      return new Response(JSON.stringify({ match: hcs === "match" }), {
        status: 200,
      });
    }
    if (url.includes(HF_HOST)) {
      return new Response(JSON.stringify([{ label: "nsfw", score: nsfw }]), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });
const asSiteAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_erin", metadata: { role: "admin" } });

// Alice owns the circle, Carol is a member, Dave is not in it; Erin is a site admin.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mk("alice"),
      carol: await mk("carol"),
      dave: await mk("dave"),
      erin: await mk("erin"),
    };
  });
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Saturday Puzzlers" },
  )) as string;
  await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
    circleId,
    memberId: ids.carol,
    permission: "ViewOnly",
  });
  return { ...ids, circleId };
};
type Seeded = Awaited<ReturnType<typeof seed>>;

type IconFields = Partial<
  Pick<
    Doc<"circleIcons">,
    "hashCheckedAt" | "hashCheckPendingSince" | "hashCheckTimedOutAt"
  >
>;

// An icon row as the pipeline leaves it.
const seedIcon = async (
  t: T,
  s: Seeded,
  moderationStatus: Doc<"circleIcons">["moderationStatus"],
  fields: IconFields = { hashCheckedAt: 1 },
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
) => {
  const fileId = await storeBytes(t, bytes);
  const iconId = await t.run((ctx) =>
    ctx.db.insert("circleIcons", {
      circleId: s.circleId,
      uploaderId: s.alice,
      fileId,
      moderationStatus,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    }),
  );
  return { iconId, fileId };
};

const seedRendition = async (t: T, sourceId: Id<"_storage">) => {
  const small = await storeWebp(t, `rendition of ${sourceId}`);
  await t.run((ctx) =>
    ctx.db.insert("imageRenditions", {
      sourceId,
      width: 1600,
      height: 1600,
      small: { fileId: small, width: 256, height: 256 },
      createdAt: Date.now(),
    }),
  );
  return small;
};

// An 800 x 800 icon sent through the pipeline, as sharing/setCircleIcon does.
const uploadIcon = async (t: T, s: Seeded) => {
  const fileId = await storeBytes(t, await jpeg(800, 800));
  await t.run(async (ctx) => {
    const iconId = await ctx.db.insert("circleIcons", {
      circleId: s.circleId,
      uploaderId: s.alice,
      fileId,
      moderationStatus: "pending",
      hashCheckPendingSince: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await enqueueImageModeration(ctx, "circleIcon", iconId);
  });
  await settleDueScheduled(t);
  const [row] = await t.run((ctx) => ctx.db.query("circleIcons").collect());
  return row;
};

const iconUrl = async (t: T, who: Who, circleId: string) =>
  (await as(t, who).query(api.sharing.getCircle.getCircle, { circleId }))
    ?.iconUrl;

const generate = internal.lib.imageModeration.renditions.generateRenditions;
const backfill = internal.lib.imageModeration.renditions.backfillRenditions;

describe("circle icon renditions: made once the icon may be served", () => {
  test("a clean icon gets one small WebP in the background, and members are served it", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const row = await uploadIcon(t, s);
    expect(row.moderationStatus).toBe("approved");
    await settleRenditions(t);

    const renditions = await allRenditions(t);
    expect(renditions).toEqual([
      expect.objectContaining({
        sourceId: row.fileId,
        width: 800,
        height: 800,
        small: expect.objectContaining({ width: 256, height: 256 }),
      }),
    ]);
    expect(renditions[0].medium).toBeUndefined();
    expect(renditions[0].large).toBeUndefined();
    const small = renditions[0].small!.fileId;
    expect(await blobType(t, small)).toBe("image/webp");
    expect(await iconUrl(t, "carol", s.circleId)).toBe(await urlOf(t, small));
  });

  test("an icon approved while its hash check is out gets none until the check passes", async () => {
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const row = await uploadIcon(t, s);
    expect(row.moderationStatus).toBe("approved");
    expect(await scheduledRenditions(t)).toEqual([]);

    await t.mutation(internal.sharing.circleIconModerationStore.setHashCheck, {
      imageId: row._id,
      status: "no_match",
    });
    expect(await scheduledRenditions(t)).toEqual([row.fileId]);
  });

  test("an icon the classifier rejects gets none", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const row = await uploadIcon(t, s);
    await settleRenditions(t);

    expect(row.moderationStatus).toBe("rejected");
    expect(await scheduledRenditions(t)).toEqual([]);
    expect(await allRenditions(t)).toEqual([]);
  });

  test.each(["pending", "unscored", "rejected", "quarantined"] as const)(
    "a %s icon gets none, and nothing is stored",
    async (status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const icon = await seedIcon(
        t,
        s,
        status,
        { hashCheckedAt: 1 },
        await jpeg(300, 300),
      );
      const before = await blobCount(t);

      expect(await t.action(generate, { sourceId: icon.fileId })).toBe(
        "not_eligible",
      );

      expect(await allRenditions(t)).toEqual([]);
      expect(await blobCount(t)).toBe(before);
    },
  );

  test("an admin's approval schedules it", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const icon = await seedIcon(t, s, "unscored");

    await asSiteAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "circleIcon", imageId: icon.iconId, decision: "approve" },
    );

    expect(await scheduledRenditions(t)).toEqual([icon.fileId]);
  });
});

describe("circle icon renditions: deleted with the icon", () => {
  const expectGone = async (t: T, rendition: Id<"_storage">) => {
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
  };

  test("removing the icon", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved");
    const rendition = await seedRendition(t, icon.fileId);

    await as(t, "alice").mutation(
      api.sharing.removeCircleIcon.removeCircleIcon,
      { circleId: s.circleId },
    );

    await expectGone(t, rendition);
    expect(await blobExists(t, icon.fileId)).toBe(false);
  });

  test("a newer icon replacing it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const old = await seedIcon(t, s, "approved");
    const rendition = await seedRendition(t, old.fileId);
    const newer = await seedIcon(t, s, "approved", {
      hashCheckPendingSince: 1,
    });

    await t.mutation(internal.sharing.circleIconModerationStore.setHashCheck, {
      imageId: newer.iconId,
      status: "no_match",
    });

    expect(await blobExists(t, rendition)).toBe(false);
    expect(await blobExists(t, old.fileId)).toBe(false);
    expect(
      (await allRenditions(t)).filter((row) => row.sourceId === old.fileId),
    ).toEqual([]);
  });

  test("an admin's rejection of an approved icon whose hash check timed out", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved", {
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
    });
    const rendition = await seedRendition(t, icon.fileId);

    await asSiteAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "circleIcon", imageId: icon.iconId, decision: "reject" },
    );

    await expectGone(t, rendition);
    expect(await blobExists(t, icon.fileId)).toBe(false);
  });

  test("a hash match deletes it before the row moves to the preserved blob; the escalation is still raised", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved");
    const rendition = await seedRendition(t, icon.fileId);
    const preserved = await storeBytes(t, new Uint8Array([9, 9, 9]));

    await t.mutation(internal.sharing.circleIconModerationStore.quarantine, {
      imageId: icon.iconId,
      fileId: preserved,
      uploaderId: s.alice,
      md5: "md5",
      sha1: "sha1",
      provider: "offlimits",
      originalDiscarded: false,
    });

    await expectGone(t, rendition);
    expect(await iconUrl(t, "carol", s.circleId)).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([
      expect.objectContaining({
        table: "circleIcons",
        rowId: icon.iconId,
        fileId: preserved,
        status: "open",
      }),
    ]);
  });

  test("a verdict that rejects a pending icon leaves no rendition behind", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "pending");
    const rendition = await seedRendition(t, icon.fileId);

    await t.mutation(internal.sharing.circleIconModerationStore.setVerdict, {
      imageId: icon.iconId,
      moderationStatus: "rejected",
      moderationScore: 0.99,
    });

    await expectGone(t, rendition);
  });
});

describe("circle icon renditions: served behind the icon's gate, as a URL", () => {
  test("a member gets the rendition's URL; a non-member gets neither URL", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved");
    const rendition = await seedRendition(t, icon.fileId);
    const url = await urlOf(t, rendition);

    expect(await iconUrl(t, "carol", s.circleId)).toBe(url);
    const listed = await as(t, "carol").query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(listed.map((circle) => circle.iconUrl)).toEqual([url]);

    const outsider = JSON.stringify(
      await as(t, "dave").query(api.sharing.listMyCircles.listMyCircles, {}),
    );
    expect(outsider).not.toContain(url);
    expect(await iconUrl(t, "dave", s.circleId)).toBeUndefined();
  });

  test("before the backfill the original is served, as before", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved");

    expect(await iconUrl(t, "carol", s.circleId)).toBe(
      await urlOf(t, icon.fileId),
    );
  });

  test("an icon that has not passed its hash check is not served, nor is its rendition", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const icon = await seedIcon(t, s, "approved", { hashCheckPendingSince: 1 });
    await seedRendition(t, icon.fileId);

    expect(await iconUrl(t, "carol", s.circleId)).toBeUndefined();
  });
});

describe("circle icon renditions: the backfill", () => {
  const seedIcons = async (t: T, s: Seeded) => {
    const bytes = await jpeg(300, 300);
    const approved = await seedIcon(
      t,
      s,
      "approved",
      { hashCheckedAt: 1 },
      bytes,
    );
    const pending = await seedIcon(t, s, "pending", {}, bytes);
    const quarantined = await seedIcon(t, s, "quarantined", {}, bytes);
    const done = await seedIcon(t, s, "approved");
    await seedRendition(t, done.fileId);
    return { approved, pending, quarantined, done };
  };

  test("is a dry run by default: counts the icons that would get one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedIcons(t, s);
    const before = await blobCount(t);

    expect(await t.action(backfill, { table: "circleIcon" })).toEqual({
      scanned: 4,
      candidates: 1,
      recorded: 0,
      refused: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await blobCount(t)).toBe(before);
  });

  test("a real run covers approved icons, continues page by page and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const seeded = await seedIcons(t, s);
    vi.useFakeTimers();

    await t.action(backfill, {
      table: "circleIcon",
      dryRun: false,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await allRenditions(t)).map((row) => row.sourceId)).toEqual(
      expect.arrayContaining([seeded.approved.fileId, seeded.done.fileId]),
    );
    expect(backfillDoneEvent(logged)).toMatchObject({
      table: "circleIcon",
      scanned: 4,
      candidates: 1,
      recorded: 1,
    });

    vi.useRealTimers();
    expect(
      await t.action(backfill, { table: "circleIcon", dryRun: false }),
    ).toMatchObject({ candidates: 0, recorded: 0 });
  });
});
