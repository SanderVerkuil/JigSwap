import { createHash } from "node:crypto";
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

// End-to-end tests for the CSAM hash check in the shared moderation pipeline: a match
// quarantines the photo before classification (never classified, never served to anyone, blob
// preserved, escalation raised); "unavailable" continues to classification; the admin views are
// isAdmin-gated and carry metadata only. HCS and the classifier are a routed fake `fetch`.

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

// HCS answers `hcs` (a match, no match, or an HTTP status); the classifier always says clean.
const routedFetch = (hcs: "match" | "no_match" | number) =>
  vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
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
      return new Response(JSON.stringify([{ label: "nsfw", score: 0.01 }]), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const callsTo = (fetchMock: ReturnType<typeof routedFetch>, host: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes(host));

const seed = async (t: TestConvex<typeof schema>) =>
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
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      // Bob holds the copy (a loan), which lets him view its page: the "other member".
      heldBy: bob,
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, copy, copyAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

const settleDueJobs = (t: TestConvex<typeof schema>) => settleDueScheduled(t);

// A real (unique) JPEG so the re-encode runs; returns its id and the bytes' hashes.
const storeJpeg = async (t: TestConvex<typeof schema>) => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  const fileId = (await t.run((ctx) =>
    ctx.storage.store(new Blob([bytes], { type: "image/jpeg" })),
  )) as Id<"_storage">;
  return {
    fileId,
    md5: createHash("md5").update(bytes).digest("hex"),
    sha1: createHash("sha1").update(bytes).digest("hex"),
  };
};

const blobExists = (t: TestConvex<typeof schema>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const addCopyPhoto = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
) => {
  const upload = await storeJpeg(t);
  const imageId = await asAlice(t).mutation(
    api.library.addCopyPhoto.addCopyPhoto,
    { copyId: copy, fileId: upload.fileId, tag: "box_front" },
  );
  await settleDueJobs(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return { row, upload, imageId };
};

const escalations = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("csamEscalations").collect());

describe("hash match on a copy photo", () => {
  test("quarantines before classification, preserves the bytes under a NEW blob and raises an escalation", async () => {
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);

    const { row, upload } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("quarantined");
    // Never classified, never swapped to a re-encode. The matched bytes live on in a NEW blob
    // (no URL was ever issued for it); the uploaded blob, whose URL may have been, is gone.
    expect(callsTo(fetchMock, HF_HOST)).toHaveLength(0);
    expect(row.moderationScore).toBeUndefined();
    expect(row.blurhash).toBeUndefined();
    expect(row.fileId).not.toBe(upload.fileId);
    expect(await blobExists(t, upload.fileId)).toBe(false);
    expect(await blobExists(t, row.fileId)).toBe(true);
    const preserved = new Uint8Array(
      await t.run(async (ctx) =>
        (await ctx.storage.get(row.fileId))!.arrayBuffer(),
      ),
    );
    expect(createHash("md5").update(preserved).digest("hex")).toBe(upload.md5);

    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({
      table: "ownedPuzzleImages",
      rowId: row._id,
      uploaderId: alice,
      fileId: row.fileId,
      originalDiscarded: false,
      // The hashes of the ORIGINAL upload (what hash lists match).
      md5: upload.md5,
      sha1: upload.sha1,
      provider: "offlimits",
      status: "open",
    });
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps).toEqual([
      expect.objectContaining({
        kind: "image_quarantined",
        targetId: escalation._id,
        targetLabel: "Copy photo",
      }),
    ]);
    expect(stamps[0].actorId).toBeUndefined();
    // No notification to the uploader (DSA Art. 17/18 note in lib/imageModeration/quarantine).
    expect(
      await t.run((ctx) => ctx.db.query("notifications").collect()),
    ).toEqual([]);
  });

  test("the photo is never served to anyone: not the uploader, not other members, not admins", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    await t.run((ctx) => ctx.db.patch(copy, { coverImageId: row._id }));
    const url = await t.run((ctx) => ctx.storage.getUrl(row.fileId));

    const reads = [
      await asAlice(t).query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: copy },
      ),
      await asBob(t).query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: copy },
      ),
    ];
    for (const view of reads) {
      expect(view?.gallery).toEqual([]);
      expect(view?.pendingPhotos).toEqual([]);
      expect(view?.snapshot.coverImageId).toBeNull();
    }
    const escalationList = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    const adminReads = [
      await asAdmin(t).query(
        api.admin.listRejectedPhotos.listRejectedPhotos,
        {},
      ),
      await asAdmin(t).query(
        api.admin.listUncheckedPhotos.listUncheckedPhotos,
        {},
      ),
      escalationList,
    ];
    expect(adminReads[0]).toEqual([]);
    expect(adminReads[1]).toEqual([]);
    for (const json of [...reads, ...adminReads].map((r) =>
      JSON.stringify(r),
    )) {
      expect(json).not.toContain(url!);
      expect(json).not.toContain(row.fileId);
    }
    // The escalation list is metadata only.
    const [listed] = escalationList.escalations;
    expect(Object.keys(listed).sort()).toEqual(
      [
        "id",
        "md5",
        "matchedAt",
        "notes",
        "provider",
        "reportedAt",
        "sha1",
        "status",
        "table",
        "uploaderId",
        "uploaderLabel",
        "uploaderSnapshot",
      ].sort(),
    );
    // An admin cannot hand-decide it from the unchecked queue either.
    await expect(
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId: row._id,
        decision: "approve",
      }),
    ).rejects.toThrow("already decided");
  });

  test("the uploader removing it succeeds silently and destroys nothing", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row, upload } = await addCopyPhoto(t, copy);

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: row._id,
    });

    expect((await t.run((ctx) => ctx.db.get(row._id)))?.moderationStatus).toBe(
      "quarantined",
    );
    expect(await blobExists(t, row.fileId)).toBe(true);
    expect(upload.fileId).not.toBe(row.fileId);
  });
});

describe("hash check outcomes that continue", () => {
  test("unavailable (HCS 503) continues to classification", async () => {
    const fetchMock = routedFetch(503);
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expect(callsTo(fetchMock, "hcs.example.test").length).toBeGreaterThan(0);
    expect(callsTo(fetchMock, HF_HOST)).toHaveLength(1);
    expect(await escalations(t)).toEqual([]);
  });

  test("no_match checks the original and the re-encode, then classifies", async () => {
    const fetchMock = routedFetch("no_match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row, upload } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    const bodies = callsTo(fetchMock, "hcs.example.test").map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as object,
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ md5: upload.md5, sha1: upload.sha1 });
    // The second hash is of the re-encode exactly as it was then stored.
    const stored = new Uint8Array(
      (await t.run(async (ctx) =>
        (await ctx.storage.get(row.fileId))!.arrayBuffer(),
      )) as ArrayBuffer,
    );
    expect(bodies[1]).toEqual({
      md5: createHash("md5").update(stored).digest("hex"),
      sha1: createHash("sha1").update(stored).digest("hex"),
    });
    // The original was swapped for the re-encode and deleted, as before.
    expect(row.fileId).not.toBe(upload.fileId);
    expect(await blobExists(t, upload.fileId)).toBe(false);
  });

  test("unconfigured: no hash-check call at all", async () => {
    vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addCopyPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expect(callsTo(fetchMock, "hcs.example.test")).toHaveLength(0);
  });
});

describe("hash match on a completion photo", () => {
  test("quarantined, dropped from the completion, never served, and kept when the completion is deleted", async () => {
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const upload = await storeJpeg(t);
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [upload.fileId] },
    );
    await settleDueJobs(t);

    const [sidecar] = await t.run((ctx) =>
      ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) => q.eq("completionId", completionId))
        .collect(),
    );
    expect(sidecar.moderationStatus).toBe("quarantined");
    expect(callsTo(fetchMock, HF_HOST)).toHaveLength(0);
    const completion = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(completion?.photos).toEqual([]);
    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({
      table: "completionImages",
      rowId: sidecar._id,
      fileId: sidecar.fileId,
      md5: upload.md5,
    });

    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine[0].photoItems).toEqual([]);
    const profile = await asBob(t).query(
      api.social.listProfileCompletions.listProfileCompletions,
      { memberId: alice, paginationOpts: { numItems: 10, cursor: null } },
    );
    for (const entry of profile.page) {
      expect(entry.photoUrls).toEqual([]);
      expect(entry.pendingPhotos).toEqual([]);
    }

    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });
    expect(await blobExists(t, sidecar.fileId)).toBe(true);
    expect(await blobExists(t, upload.fileId)).toBe(false);
    expect(await escalations(t)).toHaveLength(1);
  });
});

describe("admin escalation functions", () => {
  test("list and mark are admin-only", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    await addCopyPhoto(t, copy);
    const [escalation] = await escalations(t);

    await expect(
      asAlice(t).query(api.admin.listCsamEscalations.listCsamEscalations, {}),
    ).rejects.toThrow(ConvexError);
    await expect(
      asAlice(t).mutation(api.admin.markCsamEscalation.markCsamEscalation, {
        id: escalation._id,
        status: "closed",
      }),
    ).rejects.toThrow(ConvexError);
    expect((await escalations(t))[0].status).toBe("open");
  });

  test("open -> reported -> closed only; notes are append-only; every update is stamped with the admin (L1)", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { bob, copy } = await seed(t);
    await addCopyPhoto(t, copy);
    const [escalation] = await escalations(t);
    const mark = (status: "open" | "reported" | "closed", note?: string) =>
      asAdmin(t).mutation(api.admin.markCsamEscalation.markCsamEscalation, {
        id: escalation._id,
        status,
        ...(note === undefined ? {} : { note }),
      });

    // Closing before reporting, and skipping back, are refused.
    await expect(mark("closed")).rejects.toThrow("Cannot go from open");
    await mark("reported", "  Meldpunt ref 1234 ");
    const reported = (await escalations(t))[0];
    expect(reported.status).toBe("reported");
    expect(reported.reportedAt).toBeGreaterThan(0);
    expect(reported.notes).toEqual([
      { at: expect.any(Number), actorId: bob, text: "Meldpunt ref 1234" },
    ]);
    await expect(mark("open")).rejects.toThrow("Cannot go from reported");

    // Same status + note appends; nothing is ever replaced.
    await mark("reported", "police informed");
    await mark("closed");
    await expect(mark("open")).rejects.toThrow("Cannot go from closed");
    const closed = (await escalations(t))[0];
    expect(closed.status).toBe("closed");
    expect(closed.reportedAt).toBe(reported.reportedAt);
    expect(closed.notes?.map((n) => n.text)).toEqual([
      "Meldpunt ref 1234",
      "police informed",
    ]);

    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    const updates = stamps.filter(
      (st) => st.kind === "csam_escalation_updated",
    );
    expect(updates).toHaveLength(3);
    expect(updates.every((st) => st.actorId === bob)).toBe(true);
    expect(updates.every((st) => st.targetId === escalation._id)).toBe(true);

    const listed = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(listed.hashCheck).toMatchObject({
      provider: "offlimits",
      status: "ok",
      missingVars: [],
      waitingPhotos: 0,
    });
    expect(listed.escalations.map((e) => e.status)).toEqual(["closed"]);
    expect(JSON.stringify(listed)).not.toContain("s3cret-pass");
  });
});

// A pending copy photo inserted directly (as addCopyPhoto does), its hash check not yet passed.
const seedUncheckedRow = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
  uploader: Id<"users">,
  fields: Record<string, unknown> = {},
) => {
  const { fileId } = await storeJpeg(t);
  const now = Date.now();
  const imageId = await t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: uploader,
      fileId,
      moderationStatus: "pending",
      hashCheckPendingSince: now,
      createdAt: now,
      updatedAt: now,
      ...fields,
    } as never),
  );
  return { imageId: imageId as Id<"ownedPuzzleImages">, fileId };
};

describe("publication gate: no URL before the hash check has passed (C1)", () => {
  test("hash service unreachable: classified and approved, but served to nobody, the uploader included", async () => {
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    expect(row.moderationStatus).toBe("approved");
    expect(row.hashCheckedAt).toBeUndefined();
    await t.run((ctx) => ctx.db.patch(copy, { coverImageId: row._id }));
    const url = await t.run((ctx) => ctx.storage.getUrl(row.fileId));

    for (const who of [asAlice, asBob]) {
      const view = await who(t).query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: copy },
      );
      expect(view?.gallery).toEqual([]);
      expect(view?.snapshot.coverImageId).toBeNull();
      // A placeholder without the blurhash.
      expect(view?.pendingPhotos).toEqual([
        { blurhash: null, createdAt: row.createdAt },
      ]);
      expect(JSON.stringify(view)).not.toContain(url!);
    }
  });

  test("no_match opens the gate: hashCheckedAt is set and other members see the photo", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    expect(row.hashCheckedAt).toBeGreaterThan(0);
    expect(row.hashCheckPendingSince).toBeUndefined();
    const view = await asBob(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.gallery).toHaveLength(1);
  });

  test("admins get no URL for an unchecked photo and cannot decide it", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const { imageId } = await seedUncheckedRow(t, copy, alice, {
      moderationStatus: "unscored",
    });

    const queue = await asAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].url).toBeNull();
    await expect(
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId,
        decision: "approve",
      }),
    ).rejects.toThrow("hash check");
    expect((await t.run((ctx) => ctx.db.get(imageId)))?.moderationStatus).toBe(
      "unscored",
    );
  });

  test("an unchecked completion photo is not served to its uploader", async () => {
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    const { copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const upload = await storeJpeg(t);
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [upload.fileId] },
    );
    await settleDueJobs(t);
    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine[0].photoItems).toEqual([]);
  });
});

describe("a match is never lost when the row changed meanwhile (H2)", () => {
  const match = async (
    t: TestConvex<typeof schema>,
    imageId: Id<"ownedPuzzleImages">,
    uploaderId: Id<"users">,
  ) => {
    const { fileId } = await storeJpeg(t);
    const escalationId = await t.mutation(
      internal.library.moderationStore.quarantineImage,
      {
        imageId,
        fileId,
        uploaderId,
        md5: "a".repeat(32),
        sha1: "b".repeat(40),
        provider: "offlimits",
        originalDiscarded: false,
      },
    );
    return { fileId, escalationId };
  };

  test("a row an admin already approved is forced to quarantined, and its cover cleared (L4)", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const { imageId } = await seedUncheckedRow(t, copy, alice, {
      moderationStatus: "approved",
    });
    await t.run((ctx) => ctx.db.patch(copy, { coverImageId: imageId }));

    const { fileId, escalationId } = await match(t, imageId, alice);

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row?.moderationStatus).toBe("quarantined");
    expect(row?.fileId).toBe(fileId);
    expect(
      (await t.run((ctx) => ctx.db.get(copy)))?.coverImageId,
    ).toBeUndefined();
    expect((await escalations(t)).map((e) => e._id)).toEqual([escalationId]);
  });

  test("a row the uploader removed meanwhile still gets its escalation", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const { imageId } = await seedUncheckedRow(t, copy, alice);
    await t.run((ctx) => ctx.db.delete(imageId));

    const { fileId } = await match(t, imageId, alice);

    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({
      rowId: imageId,
      uploaderId: alice,
      fileId,
      status: "open",
    });
    expect(await blobExists(t, fileId)).toBe(true);
  });
});

describe("refused uploads are hash-checked first (M2)", () => {
  test("a match on bytes the input guards would refuse is quarantined, not deleted", async () => {
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = (await t.run((ctx) =>
      ctx.storage.store(new Blob(["<svg></svg>"], { type: "image/svg+xml" })),
    )) as Id<"_storage">;
    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: copy,
      fileId,
      tag: "box_front",
    });
    await settleDueJobs(t);

    const [row] = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
        .collect(),
    );
    expect(row.moderationStatus).toBe("quarantined");
    expect(await blobExists(t, row.fileId)).toBe(true);
    expect(await escalations(t)).toHaveLength(1);
  });

  test("without a match the refusal stands", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const fileId = (await t.run((ctx) =>
      ctx.storage.store(new Blob(["<svg></svg>"], { type: "image/svg+xml" })),
    )) as Id<"_storage">;
    await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: copy,
      fileId,
      tag: "box_front",
    });
    await settleDueJobs(t);
    const [row] = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
        .collect(),
    );
    expect(row.moderationStatus).toBe("rejected");
    expect(await escalations(t)).toEqual([]);
  });
});

describe("logging on a match (L2)", () => {
  test("the wide event carries the escalation id and nothing that identifies the row or uploader", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    const [escalation] = await escalations(t);

    const lines = (
      console.log as unknown as ReturnType<typeof vi.fn>
    ).mock.calls
      .concat((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls)
      .map(([line]) => String(line))
      .filter((line) => line.includes('"event":"library.moderatePhoto"'));
    const matchLine = lines.find((line) => line.includes(escalation._id));
    expect(matchLine).toBeDefined();
    const fields = JSON.parse(matchLine!) as Record<string, unknown>;
    expect(fields.escalation_id).toBe(escalation._id);
    expect(fields).not.toHaveProperty("image_id");
    expect(fields).not.toHaveProperty("uploader_id");
    expect(fields).not.toHaveProperty("decision");
    expect(matchLine).not.toContain(row._id);
    expect(matchLine).not.toContain(alice);
    expect(matchLine).not.toContain(escalation.md5);
  });
});

describe("preserved blobs can never be re-used (H1)", () => {
  const quarantineOne = async (t: TestConvex<typeof schema>) => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const { alice, copy, copyAggregateId } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    return { alice, copy, copyAggregateId, preservedId: row.fileId };
  };

  test("addCopyPhoto and attachCompletionPhotos refuse a preserved storage id with a generic not-found", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy, copyAggregateId, preservedId } = await quarantineOne(t);

    await expect(
      asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
        copyId: copy,
        fileId: preservedId,
        tag: "box_front",
      }),
    ).rejects.toThrow("File not found");
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    await expect(
      asAlice(t).mutation(
        api.solving.attachCompletionPhotos.attachCompletionPhotos,
        { completionId, storageIds: [preservedId] },
      ),
    ).rejects.toThrow("Photo not found");
    expect(await blobExists(t, preservedId)).toBe(true);
  });

  test("a row that already points at a preserved blob is quarantined at once and joins its escalation", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy, preservedId } = await quarantineOne(t);
    const now = Date.now();
    const imageId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: alice,
        fileId: preservedId,
        moderationStatus: "pending",
        hashCheckPendingSince: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await t.action(internal.library.moderatePhoto.moderatePhoto, { imageId });

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row?.moderationStatus).toBe("quarantined");
    expect(row?.fileId).toBe(preservedId);
    expect(await blobExists(t, preservedId)).toBe(true);
    expect(await escalations(t)).toHaveLength(1);
  });

  test("the owner's copy-detail read never lists a quarantined photo's storage id", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy, preservedId } = await quarantineOne(t);
    const detail = await asAlice(t).query(
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
      { ownedPuzzleId: copy },
    );
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain(preservedId);
  });
});

describe("unavailable hash check: stored hashes, re-checks, held unpublished (M1)", () => {
  const unavailableUpload = async (t: TestConvex<typeof schema>) => {
    vi.stubGlobal("fetch", routedFetch(503));
    const seeded = await seed(t);
    const { row, upload } = await addCopyPhoto(t, seeded.copy);
    return { ...seeded, row, upload };
  };

  test("the hashes of the original and the re-encode are stored and a re-check is armed in ~15 min", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { row, upload } = await unavailableUpload(t);

    expect(row.hashCheckedAt).toBeUndefined();
    expect(row.hashCheckPendingSince).toBeGreaterThan(0);
    expect(row.pendingHashes).toHaveLength(2);
    expect(row.pendingHashes![0]).toEqual({
      md5: upload.md5,
      sha1: upload.sha1,
    });
    // The original was still replaced by its re-encode (no indefinite retention).
    expect(await blobExists(t, upload.fileId)).toBe(false);
    // The first re-check is armed on the hash re-check Workpool (hashRecheckPool).
    expect(row.hashRecheckAttempt).toBe(1);
    expect(row.hashRecheckDueAt! - Date.now()).toBeGreaterThan(14 * 60_000);

    const listed = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(listed.hashCheck.waitingPhotos).toBe(1);
    expect(listed.hashCheck.oldestWaitingSince).toBe(row.hashCheckPendingSince);
  });

  test("a later match quarantines the re-encode, records the discarded original, and stops waiting", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { row } = await unavailableUpload(t);
    vi.stubGlobal("fetch", routedFetch("match"));

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId: row._id,
      attempt: 1,
      pooled: true,
    });

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after?.moderationStatus).toBe("quarantined");
    expect(after?.fileId).not.toBe(row.fileId);
    expect(await blobExists(t, row.fileId)).toBe(false);
    expect(await blobExists(t, after!.fileId)).toBe(true);
    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({
      fileId: after!.fileId,
      originalDiscarded: true,
    });
    const listed = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(listed.hashCheck.waitingPhotos).toBe(0);
  });

  test("a later no_match publishes the photo", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { row, copy } = await unavailableUpload(t);
    vi.stubGlobal("fetch", routedFetch("no_match"));

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId: row._id,
      attempt: 1,
      pooled: true,
    });

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after?.hashCheckedAt).toBeGreaterThan(0);
    expect(after?.pendingHashes).toBeUndefined();
    const view = await asBob(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.gallery).toHaveLength(1);
  });

  test("still unavailable: backs off (doubling, capped at 24 h)", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { row } = await unavailableUpload(t);
    await t.run((ctx) => ctx.db.patch(row._id, { hashRecheckAttempt: 9 }));

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId: row._id,
      attempt: 9,
      pooled: true,
    });

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after?.hashRecheckAttempt).toBe(10);
    const delay = after!.hashRecheckDueAt! - Date.now();
    expect(delay).toBeGreaterThan(23 * 3_600_000);
    expect(delay).toBeLessThanOrEqual(24 * 3_600_000);
    expect(after?.hashCheckedAt).toBeUndefined();
  });

  test("provider none: hashCheckedAt is set at once, nothing waits", async () => {
    vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "none");
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addCopyPhoto(t, copy);
    expect(row.hashCheckedAt).toBeGreaterThan(0);
    expect(row.pendingHashes).toBeUndefined();
  });
});

describe("re-screen hash-checks legacy and unscored photos (M6)", () => {
  test("a legacy photo that matches is quarantined and never classified", async () => {
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const upload = await storeJpeg(t);
    const now = Date.now();
    // Legacy: no moderation status, no hash-check fields (predates the gate).
    const imageId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: alice,
        fileId: upload.fileId,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      { table: "copy", dryRun: false },
    );

    expect(batch.quarantined).toBe(1);
    expect(callsTo(fetchMock, HF_HOST)).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row?.moderationStatus).toBe("quarantined");
    expect(await blobExists(t, upload.fileId)).toBe(false);
    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({ rowId: imageId, md5: upload.md5 });
    expect(await blobExists(t, escalation.fileId!)).toBe(true);
  });

  test("unavailable does not hold up the re-screen", async () => {
    const fetchMock = routedFetch(503);
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    const upload = await storeJpeg(t);
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: alice,
        fileId: upload.fileId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      { table: "copy", dryRun: false },
    );
    expect(batch.approved).toBe(1);
    expect(await escalations(t)).toEqual([]);
  });
});

describe("uploader identity survives account deletion (M5)", () => {
  test("the escalation snapshots the uploader; deleting the account tombstones it while the escalation is open", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    await addCopyPhoto(t, copy);
    const [escalation] = await escalations(t);
    expect(escalation.uploaderSnapshot).toEqual({
      clerkId: "clerk_alice",
      email: "clerk_alice@example.com",
      name: "clerk_alice",
      username: undefined,
    });

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });

    const tombstone = await t.run((ctx) => ctx.db.get(alice));
    expect(tombstone).not.toBeNull();
    expect(tombstone?.isActive).toBe(false);
    expect(tombstone?.email).toBeUndefined();
    expect(tombstone?.name).toBeUndefined();
    const listed = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(listed.escalations[0].uploaderLabel).toBe("clerk_alice");
  });

  test("once every escalation is closed the account is deleted as usual", async () => {
    vi.stubGlobal("fetch", routedFetch("match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copy } = await seed(t);
    await addCopyPhoto(t, copy);
    const [escalation] = await escalations(t);
    await t.run((ctx) => ctx.db.patch(escalation._id, { status: "closed" }));

    await t.mutation(internal.users.deleteUser, { id: "clerk_alice" });

    expect(await t.run((ctx) => ctx.db.get(alice))).toBeNull();
    expect((await escalations(t))[0].uploaderSnapshot?.clerkId).toBe(
      "clerk_alice",
    );
  });
});
