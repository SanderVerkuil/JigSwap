import { createHash } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Box art goes through the shared image-moderation pipeline (catalog/moderateBoxArt): the CSAM
// hash check (a match quarantines + escalates exactly like a copy photo, and the uploader is
// refused with the same answer as for content the classifier refuses) and the content check.
// Box art the first attempt could not decide is accepted by the catalog but not served until
// it is approved with its hash check passed. HCS and the classifier are a routed fake `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";
const SHOP_URL = "https://shop.example/box.jpg";

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

type Answer = "match" | "no_match" | number;

// HCS answers `hcs` (a match, no match, or an HTTP status); the classifier scores `nsfw` (or
// answers an HTTP status); the shop serves `shop` bytes.
const routedFetch = (hcs: Answer, nsfw: number = 0.01, shop?: Uint8Array) =>
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
      if (nsfw > 1) return new Response("loading", { status: nsfw });
      return new Response(JSON.stringify([{ label: "nsfw", score: nsfw }]), {
        status: 200,
      });
    }
    if (url === SHOP_URL && shop) {
      return new Response(shop as BodyInit, { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const callsTo = (fetchMock: ReturnType<typeof routedFetch>, host: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes(host));

const seed = (t: TestConvex<typeof schema>) =>
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
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, definitionId, puzzleId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

// A real (unique) JPEG so the re-encode runs; also its hashes.
const jpeg = async () => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
  return {
    bytes,
    md5: createHash("md5").update(bytes).digest("hex"),
    sha1: createHash("sha1").update(bytes).digest("hex"),
  };
};

const uploadJpeg = async (t: TestConvex<typeof schema>) => {
  const art = await jpeg();
  const fileId = (await t.run((ctx) =>
    ctx.storage.store(new Blob([art.bytes], { type: "image/jpeg" })),
  )) as Id<"_storage">;
  return { ...art, fileId };
};

const sanitize = (
  t: TestConvex<typeof schema>,
  storageId: Id<"_storage">,
  as: typeof asAlice = asAlice,
) => as(t).action(api.catalog.sanitizeBoxArt.sanitizeBoxArt, { storageId });

const errorData = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data : String(error);
  }
  throw new Error("expected a refusal");
};

const blobExists = (t: TestConvex<typeof schema>, id: string) =>
  t.run(
    async (ctx) => (await ctx.db.system.get(id as Id<"_storage">)) !== null,
  );

const listings = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("boxArtUploads").collect());
const escalations = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("csamEscalations").collect());
const stamps = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());
const imageOf = async (t: TestConvex<typeof schema>, puzzleId: Id<"puzzles">) =>
  (await t.query(api.catalog.getPuzzleById.getPuzzleById, { puzzleId }))
    ?.image ?? null;

// Expect a CSAM escalation for box-art row `rowId` whose preserved blob holds the matched bytes.
const expectEscalation = async (
  t: TestConvex<typeof schema>,
  rowId: string,
  matched: { md5: string; sha1: string } | null,
) => {
  const [row] = await listings(t);
  expect(row).toMatchObject({ _id: rowId, moderationStatus: "quarantined" });
  const [escalation] = await escalations(t);
  expect(escalation).toMatchObject({
    table: "boxArtUploads",
    rowId,
    fileId: row.storageId,
    provider: "offlimits",
    status: "open",
    ...(matched ?? {}),
  });
  expect(await blobExists(t, row.storageId)).toBe(true);
  expect(await stamps(t)).toEqual([
    expect.objectContaining({
      kind: "image_quarantined",
      targetLabel: "Box art",
      targetId: escalation._id,
    }),
  ]);
  // No notification to the uploader (lib/imageModeration/quarantine).
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual(
    [],
  );
  return row;
};

describe("box art: hash match at upload", () => {
  test("an upload is refused like refused content, quarantined, preserved and escalated, never classified", async () => {
    const fetchMock = routedFetch("match");
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { alice } = await seed(t);
    const upload = await uploadJpeg(t);

    expect(await errorData(sanitize(t, upload.fileId))).toEqual({
      code: "InvalidImage",
      message: "This image can't be used",
      reason: "not_allowed",
    });

    const [listing] = await listings(t);
    const row = await expectEscalation(t, listing._id, {
      md5: upload.md5,
      sha1: upload.sha1,
    });
    expect((await escalations(t))[0].uploaderId).toBe(alice);
    expect(row.storageId).not.toBe(upload.fileId);
    expect(await blobExists(t, upload.fileId)).toBe(false);
    expect(callsTo(fetchMock, HF_HOST)).toHaveLength(0);
    // The quarantined listing can't be used as box art either.
    expect(
      await errorData(
        asAlice(t).mutation(
          api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
          { title: "Lake", pieceCount: 500, image: row.storageId },
        ),
      ),
    ).toMatchObject({ code: "InvalidImage" });
  });

  test("a fetched shop image is checked the same way", async () => {
    const art = await jpeg();
    vi.stubGlobal("fetch", routedFetch("match", 0.01, art.bytes));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);

    expect(
      await errorData(
        asAlice(t).action(api.catalog.importPuzzleImage.importPuzzleImage, {
          url: SHOP_URL,
        }),
      ),
    ).toMatchObject({ code: "InvalidImage", reason: "not_allowed" });
    const [listing] = await listings(t);
    await expectEscalation(t, listing._id, { md5: art.md5, sha1: art.sha1 });
  });
});

describe("box art: hash check unavailable, then a match on re-check", () => {
  // The upload is accepted (the classifier approves it) but its hash check could not run, so the
  // box art is attached yet never served; the re-check then matches.
  const acceptedUnchecked = async (
    t: TestConvex<typeof schema>,
    as: typeof asAlice = asAlice,
  ) => {
    vi.stubGlobal("fetch", routedFetch(503));
    const upload = await uploadJpeg(t);
    const image = await sanitize(t, upload.fileId, as);
    const [listing] = await listings(t);
    expect(listing).toMatchObject({
      storageId: image,
      moderationStatus: "approved",
    });
    expect(listing.hashCheckedAt).toBeUndefined();
    expect(listing.pendingHashes).toHaveLength(2);
    return { image, listing };
  };

  const recheckMatches = async (
    t: TestConvex<typeof schema>,
    imageId: Id<"boxArtUploads">,
  ) => {
    vi.stubGlobal("fetch", routedFetch("match"));
    await t.action(internal.catalog.moderateBoxArt.recheckHashes, {
      imageId,
      attempt: 1,
    });
  };

  test("a definition's box art: not served while waiting, detached and escalated on the match", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { image, listing } = await acceptedUnchecked(t);
    const definitionId = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Lake", pieceCount: 500, image },
    );
    const puzzle = await t.run((ctx) =>
      ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", definitionId as string),
        )
        .unique(),
    );
    expect(puzzle?.image).toBe(image);
    expect(await imageOf(t, puzzle!._id)).toBeNull();
    // Counted as waiting for the hash check on the admin's escalations tab.
    const waiting = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(waiting.hashCheck.waitingPhotos).toBe(1);

    await recheckMatches(t, listing._id);

    await expectEscalation(t, listing._id, null);
    expect((await escalations(t))[0].originalDiscarded).toBe(true);
    const after = await t.run((ctx) => ctx.db.get(puzzle!._id));
    expect(after?.image).toBeUndefined();
    expect(await blobExists(t, image)).toBe(false);
  });

  test("a proposal's box art: not shown to the reviewer while waiting, detached and escalated on the match", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { definitionId } = await seed(t);
    const { image, listing } = await acceptedUnchecked(t);
    const proposalId = await asAlice(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, image },
    );
    const review = () =>
      asAdmin(t).query(api.catalog.getChangeProposal.getChangeProposal, {
        changeProposalId: proposalId as string,
      });
    expect((await review())?.proposedImageUrl).toBeNull();

    await recheckMatches(t, listing._id);

    await expectEscalation(t, listing._id, null);
    const proposal = await t.run((ctx) =>
      ctx.db
        .query("puzzleChangeProposals")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", proposalId as string),
        )
        .unique(),
    );
    expect(proposal?.changes.image).toBeUndefined();
    expect((await review())?.proposedImageUrl).toBeUndefined();
  });

  test("a no_match on re-check publishes the box art", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { definitionId, puzzleId } = await seed(t);
    const { image, listing } = await acceptedUnchecked(t, asAdmin);
    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, image },
    );
    expect(await imageOf(t, puzzleId)).toBeNull();

    vi.stubGlobal("fetch", routedFetch("no_match"));
    await t.action(internal.catalog.moderateBoxArt.recheckHashes, {
      imageId: listing._id,
      attempt: 1,
    });

    expect(await imageOf(t, puzzleId)).toMatch(/^https?:\/\//);
    expect(await escalations(t)).toEqual([]);
  });
});

describe("box art: the content check", () => {
  test("content the classifier refuses is refused, deleted and stamped", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const upload = await uploadJpeg(t);

    expect(await errorData(sanitize(t, upload.fileId))).toMatchObject({
      code: "InvalidImage",
      reason: "not_allowed",
    });
    const [listing] = await listings(t);
    expect(listing).toMatchObject({
      moderationStatus: "rejected",
      moderationLabel: "nsfw",
    });
    expect(await blobExists(t, listing.storageId)).toBe(false);
    expect(await blobExists(t, upload.fileId)).toBe(false);
    expect(await stamps(t)).toEqual([
      expect.objectContaining({
        kind: "photo_auto_rejected",
        targetLabel: "Box art",
        targetId: listing._id,
      }),
    ]);
    expect(await escalations(t)).toEqual([]);
  });

  test("clean box art is approved, hash-checked and served at once", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const { definitionId, puzzleId } = await seed(t);
    const upload = await uploadJpeg(t);

    const image = await sanitize(t, upload.fileId, asAdmin);
    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, image },
    );

    const [listing] = await listings(t);
    expect(listing.moderationStatus).toBe("approved");
    expect(listing.moderationScore).toBe(0.01);
    expect(listing.hashCheckedAt).toBeGreaterThan(0);
    expect(await imageOf(t, puzzleId)).toMatch(/^https?:\/\//);
  });

  test("a classifier outage: accepted but unserved, then published by the retry", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 503));
    const t = withModerationPool(convexTest(schema, modules));
    const { definitionId, puzzleId } = await seed(t);
    const upload = await uploadJpeg(t);

    const image = await sanitize(t, upload.fileId, asAdmin);
    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, image },
    );
    const [listing] = await listings(t);
    expect(listing.moderationStatus).toBe("pending");
    expect(await imageOf(t, puzzleId)).toBeNull();

    vi.stubGlobal("fetch", routedFetch("no_match"));
    await t.action(internal.catalog.moderateBoxArt.moderateBoxArt, {
      imageId: listing._id,
      attempt: 2,
    });

    expect(await imageOf(t, puzzleId)).toMatch(/^https?:\/\//);
  });
});
