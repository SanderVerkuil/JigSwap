import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// A circle's icon (sharing/circleIcons.ts): only the circle's Admins set or remove it, every upload
// goes through the shared image-moderation pipeline (sharing/moderateCircleIcon), and members see
// it only once it is approved with its hash check passed. Non-members never get its URL. HCS and
// the classifier are a routed fake `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
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
});

type Hcs = "match" | "no_match" | number;

// HCS answers `hcs` (a match, no match, or an HTTP status); the classifier scores `nsfw` (or
// answers an HTTP status when > 1).
const routedFetch = (hcs: Hcs, nsfw: number = 0.01) =>
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
      if (nsfw > 1) return new Response("down", { status: nsfw });
      return new Response(JSON.stringify([{ label: "nsfw", score: nsfw }]), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave" | "erin";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });
// Erin is a site admin (the moderation console), not in the circle.
const asSiteAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_erin", metadata: { role: "admin" } });

// Alice owns the circle; Bob is an Admin, Carol a ViewOnly member; Dave is not in it.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mk("alice"),
      bob: await mk("bob"),
      carol: await mk("carol"),
      dave: await mk("dave"),
      erin: await mk("erin"),
    };
  });
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Saturday Puzzlers" },
  )) as string;
  for (const [memberId, permission] of [
    [ids.bob, "Admin"],
    [ids.carol, "ViewOnly"],
  ] as const) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission,
    });
  }
  return { ...ids, circleId };
};

// A real (unique) JPEG stored as an upload would be.
const upload = async (t: T, type = "image/jpeg") => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  return t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([bytes], { type }));
    // convex-test does not record an upload's content type on the `_storage` row (the real
    // upload endpoint does), so set it the way an HTTP upload would.
    // oxlint-disable-next-line typescript/no-explicit-any
    await (ctx.db as any).patch(id, { contentType: type });
    return id as Id<"_storage">;
  });
};

const setIcon = (t: T, who: Who, circleId: string, storageId: Id<"_storage">) =>
  as(t, who).mutation(api.sharing.setCircleIcon.setCircleIcon, {
    circleId,
    storageId,
  });

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError
      ? (error.data as { code?: string }).code
      : String(error);
  }
  throw new Error("expected a refusal");
};

const icons = (t: T) => t.run((ctx) => ctx.db.query("circleIcons").collect());
const blobExists = (t: T, id: string) =>
  t.run(
    async (ctx) => (await ctx.db.system.get(id as Id<"_storage">)) !== null,
  );

const detail = (t: T, who: Who, circleId: string) =>
  as(t, who).query(api.sharing.getCircle.getCircle, { circleId });
const summary = async (t: T, who: Who, circleId: string) =>
  (await as(t, who).query(api.sharing.listMyCircles.listMyCircles, {})).find(
    (c) => c.aggregateId === circleId,
  );

describe("circle icon: who may set and remove it", () => {
  test("only the circle's Admins get an upload URL, set and remove; others get CircleNotFound", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    for (const who of ["carol", "dave"] as const) {
      expect(
        await errorCode(
          as(t, who).mutation(
            api.sharing.generateCircleIconUploadUrl.generateCircleIconUploadUrl,
            { circleId },
          ),
        ),
      ).toBe("CircleNotFound");
      expect(await errorCode(setIcon(t, who, circleId, await upload(t)))).toBe(
        "CircleNotFound",
      );
      expect(
        await errorCode(
          as(t, who).mutation(api.sharing.removeCircleIcon.removeCircleIcon, {
            circleId,
          }),
        ),
      ).toBe("CircleNotFound");
    }
    expect(await icons(t)).toEqual([]);

    expect(
      typeof (await as(t, "bob").mutation(
        api.sharing.generateCircleIconUploadUrl.generateCircleIconUploadUrl,
        { circleId },
      )),
    ).toBe("string");
    expect(await setIcon(t, "bob", circleId, await upload(t))).toHaveProperty(
      "iconId",
    );
    await settleDueScheduled(t);
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeTruthy();

    await as(t, "alice").mutation(
      api.sharing.removeCircleIcon.removeCircleIcon,
      { circleId },
    );
    expect(await icons(t)).toEqual([]);
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeUndefined();
  });

  test("an unsupported type is refused and its blob deleted; a used blob is not claimable", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    const gif = await upload(t, "image/gif");
    expect(await setIcon(t, "alice", circleId, gif)).toEqual({
      refused: "UnsupportedImageType",
    });
    expect(await blobExists(t, gif)).toBe(false);

    const png = await upload(t, "image/png");
    await setIcon(t, "alice", circleId, png);
    expect(await errorCode(setIcon(t, "bob", circleId, png))).toBe(
      "InvalidUpload",
    );
  });
});

describe("circle icon: served only once approved", () => {
  test("a pending icon is not served; checking shows to the uploader and Admins only", async () => {
    // The classifier is down: the check stays pending (retries on the pool's backoff).
    vi.stubGlobal("fetch", routedFetch("no_match", 503));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const [row] = await icons(t);
    expect(row.moderationStatus).toBe("pending");

    for (const who of ["alice", "bob", "carol"] as const) {
      expect((await detail(t, who, circleId))?.iconUrl).toBeUndefined();
      expect((await summary(t, who, circleId))?.iconUrl).toBeUndefined();
    }
    expect((await detail(t, "bob", circleId))?.iconStatus).toBe("checking");
    expect((await detail(t, "alice", circleId))?.iconStatus).toBe("checking");
    expect((await detail(t, "carol", circleId))?.iconStatus).toBeUndefined();
  });

  test("an approved icon is served to members (circle, list, chat) and replaces the previous one", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    const first = await upload(t);
    await setIcon(t, "alice", circleId, first);
    await settleDueScheduled(t);
    const [approved] = await icons(t);
    expect(approved).toMatchObject({ moderationStatus: "approved" });
    // The pipeline swapped it to the re-encode and dropped the upload.
    expect(approved.reencodedAt).toBeDefined();
    expect(await blobExists(t, first)).toBe(false);

    const url = (await detail(t, "carol", circleId))?.iconUrl;
    expect(url).toBeTruthy();
    expect((await summary(t, "carol", circleId))?.iconUrl).toBe(url);
    expect((await detail(t, "carol", circleId))?.iconStatus).toBeUndefined();

    // The circle's chat row carries it too, once the thread has something for Carol.
    const threadId = (await as(t, "carol").mutation(
      api.conversation.openCircleThread.openCircleThread,
      { circleId },
    )) as string;
    await as(t, "carol").mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "hi",
    });
    const inbox = await as(t, "alice").query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    const circleRow = inbox.find((r) => r.subject.kind === "circle");
    expect(circleRow?.subject).toMatchObject({ kind: "circle", iconUrl: url });

    // A second icon: the first stays until the second is approved, then goes, row and blob.
    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const rows = await icons(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).not.toBe(approved._id);
    expect(await blobExists(t, approved.fileId)).toBe(false);
    expect((await detail(t, "carol", circleId))?.iconUrl).not.toBe(url);
  });

  test("a rejected icon is never served: the previous one stays, the uploader is told", async () => {
    const fetchMock = routedFetch("no_match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    await setIcon(t, "alice", circleId, await upload(t));
    await settleDueScheduled(t);
    const url = (await detail(t, "carol", circleId))?.iconUrl;
    expect(url).toBeTruthy();

    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const rejected = (await icons(t)).find(
      (r) => r.moderationStatus === "rejected",
    );
    expect(rejected).toBeDefined();
    expect(await blobExists(t, rejected!.fileId)).toBe(false);

    expect((await detail(t, "carol", circleId))?.iconUrl).toBe(url);
    expect((await detail(t, "bob", circleId))?.iconStatus).toBe("removed");
    expect((await detail(t, "alice", circleId))?.iconStatus).toBeUndefined();

    await as(t, "bob").mutation(
      api.sharing.dismissCircleIconNotice.dismissCircleIconNotice,
      { circleId },
    );
    expect((await detail(t, "bob", circleId))?.iconStatus).toBeUndefined();
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps).toContainEqual(
      expect.objectContaining({
        kind: "photo_auto_rejected",
        targetLabel: "Circle icon",
        targetId: rejected!._id,
      }),
    );
  });

  test("a CSAM hash match quarantines and escalates; never served, told like a refusal", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);

    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const [row] = await icons(t);
    expect(row.moderationStatus).toBe("quarantined");
    const [escalation] = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    expect(escalation).toMatchObject({
      table: "circleIcons",
      rowId: row._id,
      fileId: row.fileId,
    });
    expect(await blobExists(t, row.fileId)).toBe(true);
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeUndefined();
    expect((await detail(t, "bob", circleId))?.iconStatus).toBe("removed");

    // Removing the icon keeps the quarantined row and its preserved blob.
    await as(t, "alice").mutation(
      api.sharing.removeCircleIcon.removeCircleIcon,
      { circleId },
    );
    expect(await icons(t)).toHaveLength(1);
    expect(await blobExists(t, row.fileId)).toBe(true);
  });

  test("non-members never get the URL; a member who leaves loses it", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);
    await setIcon(t, "alice", circleId, await upload(t));
    await settleDueScheduled(t);
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeTruthy();

    expect(await detail(t, "dave", circleId)).toBeNull();
    expect(await summary(t, "dave", circleId)).toBeUndefined();

    await as(t, "carol").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    expect(await detail(t, "carol", circleId)).toBeNull();
    // Leaving doesn't touch the icon.
    expect((await detail(t, "bob", circleId))?.iconUrl).toBeTruthy();
  });

  test("deleting the circle purges its icon, row and blob", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);
    await setIcon(t, "alice", circleId, await upload(t));
    await settleDueScheduled(t);
    const [row] = await icons(t);

    await as(t, "alice").mutation(api.sharing.deleteCircle.deleteCircle, {
      circleId,
      confirmName: "Saturday Puzzlers",
    });
    await settleDueScheduled(t);
    expect(await icons(t)).toEqual([]);
    expect(await blobExists(t, row.fileId)).toBe(false);
  });
});

describe("circle icon: the admin queues", () => {
  test("an unscored icon is listed as Unchecked; Check again re-runs the pipeline", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);
    await setIcon(t, "bob", circleId, await upload(t));
    const [pending] = await icons(t);
    // As if the retries ran out on a down classifier (the pool's onComplete).
    await t.run(async (ctx) => {
      await ctx.db.patch(pending._id, {
        moderationStatus: "unscored",
        moderationReason: "provider_error",
      });
    });
    await settleDueScheduled(t);

    const queue = await asSiteAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(queue).toContainEqual(
      expect.objectContaining({
        key: `circleIcon:${pending._id}`,
        source: "circleIcon",
        status: "unscored",
        puzzleTitle: "Circle icon",
        canRecheck: true,
      }),
    );
    // Members only see "checking" meanwhile.
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeUndefined();

    await asSiteAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source: "circleIcon",
      imageId: pending._id,
    });
    await settleDueScheduled(t);
    expect((await icons(t))[0].moderationStatus).toBe("approved");
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeTruthy();
  });

  test("an admin approves an unscored icon by hand, which makes it the circle's icon", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 503));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);
    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const [row] = await icons(t);
    // Hash-cleared and re-encoded; the classifier never answered.
    expect(row.hashCheckedAt).toBeDefined();
    await t.run((ctx) =>
      ctx.db.patch(row._id, { moderationStatus: "unscored" }),
    );

    // The circle's owner is no site admin.
    await expect(
      as(t, "alice").mutation(
        api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
        { source: "circleIcon", imageId: row._id, decision: "approve" },
      ),
    ).rejects.toThrow("Forbidden");
    await asSiteAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "circleIcon", imageId: row._id, decision: "approve" },
    );
    expect((await detail(t, "carol", circleId))?.iconUrl).toBeTruthy();
  });

  test("an admin rejects an unscored icon: blob deleted, uploader told", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 503));
    const t = withModerationPool(convexTest(schema, modules));
    const { circleId } = await seed(t);
    await setIcon(t, "bob", circleId, await upload(t));
    await settleDueScheduled(t);
    const [row] = await icons(t);
    await t.run((ctx) =>
      ctx.db.patch(row._id, { moderationStatus: "unscored" }),
    );

    await asSiteAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "circleIcon", imageId: row._id, decision: "reject" },
    );
    const [after] = await icons(t);
    expect(after.moderationStatus).toBe("rejected");
    expect(await blobExists(t, after.fileId)).toBe(false);
    expect((await detail(t, "bob", circleId))?.iconStatus).toBe("removed");
  });
});
