import type { WhatsNewManifestEntry } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { WHATS_NEW_NOTIFY_BATCH } from "./whatsNew/notifyBatch";

// The real manifest may hold any entries; the fan-out is tested against fixtures.
const fixture = vi.hoisted(() => ({
  manifest: [] as WhatsNewManifestEntry[],
}));
vi.mock("./whatsNew/manifest", () => ({
  whatsNewManifest: () => fixture.manifest,
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const NOTIFY = {
  id: "households",
  publishedAt: day("2026-10-20"),
  highlight: true,
  notify: true,
};
const QUIET = {
  id: "quiet-fix",
  publishedAt: day("2026-10-15"),
  highlight: false,
  notify: false,
};

beforeEach(() => {
  fixture.manifest = [NOTIFY, QUIET];
});

type T = TestConvex<typeof schema>;

const BEFORE = day("2026-10-01");
const AFTER = day("2026-11-01");

const mkUser = (t: T, clerkId: string, createdAt: number) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    }),
  );

// Wait until every scheduled job (the batch chain) reaches a terminal state. convex-test starts
// runAfter(0) jobs via real setTimeout, so yield to the macrotask queue between rounds.
const settle = async (t: T) => {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    if (
      jobs.every(
        (job) =>
          job.state.kind !== "pending" && job.state.kind !== "inProgress",
      )
    ) {
      expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
      return;
    }
  }
  throw new Error("scheduled jobs did not settle");
};

const publish = async (t: T) => {
  const result = await t.mutation(
    internal.whatsNew.publishPending.publishPending,
    {},
  );
  await settle(t);
  return result;
};

const whatsNewNotifications = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_type", (q) => q.eq("type", "whats_new"))
      .collect(),
  );

const recipients = async (t: T) =>
  (await whatsNewNotifications(t)).map((n) => n.userId);

const publications = (t: T) =>
  t.run((ctx) => ctx.db.query("whatsNewPublications").collect());

describe("whatsNew.publishPending", () => {
  test("notifies members whose account predates the entry, in-app only, linked to the entry", async () => {
    const t = convexTest(schema, modules);
    const ann = await mkUser(t, "clerk_ann", BEFORE);
    await mkUser(t, "clerk_bob", AFTER);

    const result = await publish(t);

    expect(result).toEqual({ published: ["households"] });
    const rows = await whatsNewNotifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ann,
      relatedId: "households",
      channel: "inApp",
      isRead: false,
      subject: { kind: "whatsNew", entryId: "households" },
    });
    expect(rows[0]?.actorIds).toBeUndefined();
  });

  test("never notifies an account created after publishedAt", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_bob", AFTER);
    // Created at the exact publish instant: the entry is not unread for them either (A3).
    await mkUser(t, "clerk_cat", NOTIFY.publishedAt);

    await publish(t);

    expect(await whatsNewNotifications(t)).toEqual([]);
  });

  test("never publishes notify:false entries", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_ann", BEFORE);
    fixture.manifest = [QUIET];

    const result = await publish(t);

    expect(result).toEqual({ published: [] });
    expect(await publications(t)).toEqual([]);
    expect(await whatsNewNotifications(t)).toEqual([]);
  });

  test("a re-run sends nothing new", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_ann", BEFORE);
    await publish(t);

    // A member who joined before the entry but was inserted after the first run must not make the
    // second run resend to anyone (the entry is already recorded as published).
    await mkUser(t, "clerk_dan", BEFORE);
    const again = await publish(t);

    expect(again).toEqual({ published: [] });
    expect(await whatsNewNotifications(t)).toHaveLength(1);
    const rows = await publications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryId: "households" });
    expect(rows[0]?.completedAt).toEqual(expect.any(Number));
  });

  test("publishes only the newly flagged entry on a later deploy", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_ann", BEFORE);
    await publish(t);

    const LATER = {
      id: "tours",
      publishedAt: day("2026-10-25"),
      highlight: false,
      notify: true,
    };
    fixture.manifest = [LATER, NOTIFY, QUIET];
    const result = await publish(t);

    expect(result).toEqual({ published: ["tours"] });
    const related = (await whatsNewNotifications(t)).map((n) => n.relatedId);
    expect(related.sort()).toEqual(["households", "tours"]);
  });

  test("respects a member who turned the whats_new preference off", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_ann", BEFORE);
    const eve = await mkUser(t, "clerk_eve", BEFORE);
    await t
      .withIdentity({ subject: "clerk_ann" })
      .mutation(
        api.notifications.updateNotificationPreference
          .updateNotificationPreference,
        { type: "whats_new", channel: "inApp", enabled: false },
      );

    await publish(t);

    expect(await recipients(t)).toEqual([eve]);
  });

  test("skips a member who already saw the entry", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "clerk_ann", BEFORE);
    const eve = await mkUser(t, "clerk_eve", BEFORE);
    await t
      .withIdentity({ subject: "clerk_ann" })
      .mutation(api.whatsNew.markWhatsNewSeen.markWhatsNewSeen, {
        ids: ["households"],
      });

    await publish(t);

    expect(await recipients(t)).toEqual([eve]);
  });

  test("fans out over more members than one batch holds", async () => {
    const t = convexTest(schema, modules);
    const total = WHATS_NEW_NOTIFY_BATCH * 2 + 5;
    const ids: Id<"users">[] = await t.run(async (ctx) => {
      const out: Id<"users">[] = [];
      for (let i = 0; i < total; i++) {
        out.push(
          await ctx.db.insert("users", {
            clerkId: `clerk_${i}`,
            email: `m${i}@example.com`,
            isActive: true,
            createdAt: BEFORE,
            updatedAt: BEFORE,
          }),
        );
      }
      return out;
    });

    await publish(t);

    const got = await recipients(t);
    expect(got).toHaveLength(total);
    expect(new Set(got)).toEqual(new Set(ids));
  });
});
