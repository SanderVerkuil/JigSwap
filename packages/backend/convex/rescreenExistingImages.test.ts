import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// library/rescreenPhotos for the images that may have no moderation row: box art ("boxArt":
// puzzles.image, "proposals": changes.image) and completion photos from before the sidecars
// ("completionLegacy"). The classifier (Hugging Face shape) and the hash service are a routed
// fake `fetch`.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HF_HOST = "router.huggingface.co";
const HCS_URL = "https://hcs.example.test/api/check";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The classifier scores each image from `scores` in turn (a missing score: a body without an
// nsfw label, i.e. "could not be checked"); the hash service answers `hcs`.
const routedFetch = (scores: (number | null)[], hcs = false) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === HCS_URL) {
      return new Response(JSON.stringify({ match: hcs }), { status: 200 });
    }
    if (url.includes(HF_HOST)) {
      const score = scores.shift();
      return new Response(
        JSON.stringify(
          score == null
            ? [{ label: "other", score: 1 }]
            : [{ label: "nsfw", score }],
        ),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const classifierCalls = (fetchMock: ReturnType<typeof routedFetch>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes(HF_HOST));

const blob = (t: TestConvex<typeof schema>) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/jpeg" }),
      ) as Promise<Id<"_storage">>,
  );

const seedMember = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const seedPuzzle = (
  t: TestConvex<typeof schema>,
  alice: Id<"users">,
  image: Id<"_storage">,
  title = "Mountain Vista",
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title,
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      image,
      createdAt: now,
      updatedAt: now,
    });
  });

const rescreen = (
  t: TestConvex<typeof schema>,
  table: "boxArt" | "proposals" | "completionLegacy",
  dryRun?: boolean,
) =>
  t.action(internal.library.rescreenPhotos.rescreenPhotos, {
    table,
    ...(dryRun === undefined ? {} : { dryRun }),
  });

const listings = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("boxArtUploads").collect());
const stamps = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());
const blobExists = (t: TestConvex<typeof schema>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

describe("rescreenPhotos: box art", () => {
  test("dry run is the default: it counts and calls nothing", async () => {
    const fetchMock = routedFetch([]);
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzle(t, alice, await blob(t)); // legacy: no listing
    const scored = await blob(t);
    await seedPuzzle(t, alice, scored, "Lake");
    await t.run((ctx) =>
      ctx.db.insert("boxArtUploads", {
        storageId: scored,
        uploaderId: alice,
        moderationStatus: "approved",
        moderationScore: 0.01,
        createdAt: Date.now(),
      }),
    );

    const batch = await rescreen(t, "boxArt");
    expect(batch).toMatchObject({ scanned: 2, candidates: 1, approved: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listings(t)).toHaveLength(1);
  });

  test("a real run refuses to start when the classifier is not configured", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "");
    const fetchMock = routedFetch([0.01]);
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzle(t, alice, await blob(t));

    const batch = await rescreen(t, "boxArt", false);
    expect(batch).toMatchObject({ scanned: 0, candidates: 0, approved: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listings(t)).toEqual([]);
  });

  test("clean legacy box art is recorded approved; refused box art is detached, deleted and stamped", async () => {
    vi.stubGlobal("fetch", routedFetch([0.01, 0.97]));
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const clean = await blob(t);
    const cleanPuzzle = await seedPuzzle(t, alice, clean);
    const refused = await blob(t);
    const refusedPuzzle = await seedPuzzle(t, alice, refused, "Lake");

    const batch = await rescreen(t, "boxArt", false);
    expect(batch).toMatchObject({ candidates: 2, approved: 1, rejected: 1 });

    const byBlob = new Map((await listings(t)).map((l) => [l.storageId, l]));
    expect(byBlob.get(clean)).toMatchObject({
      uploaderId: alice,
      moderationStatus: "approved",
      moderationScore: 0.01,
    });
    expect(byBlob.get(refused)).toMatchObject({ moderationStatus: "rejected" });
    expect((await t.run((ctx) => ctx.db.get(cleanPuzzle)))?.image).toBe(clean);
    expect(
      (await t.run((ctx) => ctx.db.get(refusedPuzzle)))?.image,
    ).toBeUndefined();
    expect(await blobExists(t, refused)).toBe(false);
    expect(await stamps(t)).toEqual([
      expect.objectContaining({
        kind: "photo_auto_rejected",
        targetLabel: "Box art",
      }),
    ]);

    // Re-runnable: nothing is left to check.
    expect(await rescreen(t, "boxArt")).toMatchObject({ candidates: 0 });
  });

  test("box art that could not be checked is left as it was and counted", async () => {
    vi.stubGlobal("fetch", routedFetch([null]));
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const image = await blob(t);
    const puzzleId = await seedPuzzle(t, alice, image);

    const batch = await rescreen(t, "boxArt", false);
    expect(batch).toMatchObject({ candidates: 1, unscored: 1, approved: 0 });
    expect(await listings(t)).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBe(image);
  });

  test("unscored box art (a listing) is classified; a manually decided one is not", async () => {
    vi.stubGlobal("fetch", routedFetch([0.01]));
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const unscored = await blob(t);
    await seedPuzzle(t, alice, unscored);
    const decided = await blob(t);
    await seedPuzzle(t, alice, decided, "Lake");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("boxArtUploads", {
        storageId: unscored,
        uploaderId: alice,
        moderationStatus: "unscored",
        moderationReason: "missing_token",
        hashCheckedAt: now,
        createdAt: now,
      });
      await ctx.db.insert("boxArtUploads", {
        storageId: decided,
        uploaderId: alice,
        moderationStatus: "approved",
        moderatedBy: alice,
        createdAt: now,
      });
    });

    const batch = await rescreen(t, "boxArt", false);
    expect(batch).toMatchObject({ candidates: 1, approved: 1 });
    const byBlob = new Map((await listings(t)).map((l) => [l.storageId, l]));
    expect(byBlob.get(unscored)).toMatchObject({
      moderationStatus: "approved",
      moderationScore: 0.01,
    });
    expect(byBlob.get(unscored)?.moderationReason).toBeUndefined();
  });

  test("a hash match quarantines and escalates, without classifying", async () => {
    vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
    vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
    vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
    vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
    const fetchMock = routedFetch([0.01], true);
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const image = await blob(t);
    const puzzleId = await seedPuzzle(t, alice, image);

    const batch = await rescreen(t, "boxArt", false);
    expect(batch).toMatchObject({ candidates: 1, quarantined: 1, approved: 0 });
    expect(classifierCalls(fetchMock)).toHaveLength(0);
    const [listing] = await listings(t);
    expect(listing).toMatchObject({ moderationStatus: "quarantined" });
    expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBeUndefined();
    const [escalation] = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    expect(escalation).toMatchObject({
      table: "boxArtUploads",
      rowId: listing._id,
      uploaderId: alice,
    });
  });
});

describe("rescreenPhotos: proposals", () => {
  test("refused proposed box art is removed from the proposal", async () => {
    vi.stubGlobal("fetch", routedFetch([0.97]));
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const image = await blob(t);
    const proposalId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("puzzleChangeProposals", {
        aggregateId: crypto.randomUUID(),
        puzzleDefinitionId: crypto.randomUUID(),
        proposedBy: alice,
        status: "pending",
        changes: { image },
        baseline: {},
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(await rescreen(t, "proposals")).toMatchObject({ candidates: 1 });
    const batch = await rescreen(t, "proposals", false);
    expect(batch).toMatchObject({ candidates: 1, rejected: 1 });
    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal?.changes.image).toBeUndefined();
    expect(await blobExists(t, image)).toBe(false);
  });
});

describe("rescreenPhotos: completion photos without a sidecar", () => {
  test("a clean photo gets an approved sidecar; a refused one is detached and deleted", async () => {
    vi.stubGlobal("fetch", routedFetch([0.01, 0.97]));
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const clean = await blob(t);
    const refused = await blob(t);
    const withSidecar = await blob(t);
    const completionId = crypto.randomUUID();
    const completion = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("completionImages", {
        completionId,
        uploaderId: alice,
        fileId: withSidecar,
        moderationStatus: "approved",
        moderationScore: 0.02,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("completions", {
        aggregateId: completionId,
        userId: alice,
        startDate: now - 2000,
        endDate: now - 1000,
        photos: [clean, refused, withSidecar],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(await rescreen(t, "completionLegacy")).toMatchObject({
      scanned: 1,
      candidates: 2,
    });
    const batch = await rescreen(t, "completionLegacy", false);
    expect(batch).toMatchObject({ candidates: 2, approved: 1, rejected: 1 });

    const sidecars = new Map(
      (await t.run((ctx) => ctx.db.query("completionImages").collect())).map(
        (row) => [row.fileId, row],
      ),
    );
    expect(sidecars.get(clean)).toMatchObject({
      completionId,
      uploaderId: alice,
      moderationStatus: "approved",
      moderationScore: 0.01,
    });
    expect(sidecars.get(refused)).toMatchObject({
      moderationStatus: "rejected",
    });
    expect((await t.run((ctx) => ctx.db.get(completion)))?.photos).toEqual([
      clean,
      withSidecar,
    ]);
    expect(await blobExists(t, refused)).toBe(false);
    expect(await rescreen(t, "completionLegacy")).toMatchObject({
      candidates: 0,
    });
  });
});
