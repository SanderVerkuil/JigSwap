import { createHash } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The one-shot CSAM hash check of box art stored before box art went through the pipeline
// (lib/imageModeration/backfillBoxArtHashCheck). HCS is a fake `fetch`.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
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

const hcs = (answer: "match" | "no_match" | number) => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input) !== HCS_URL) throw new Error(`unexpected ${input}`);
    return typeof answer === "number"
      ? new Response("unavailable", { status: answer })
      : new Response(JSON.stringify({ match: answer === "match" }), {
          status: 200,
        });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const ART = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]);

// Alice's approved definition with legacy box art (no listing), and Bob's pending proposal for
// it with a proposed image of its own (baseline = the definition's art).
const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const art = await ctx.storage.store(
      new Blob([ART], { type: "image/jpeg" }),
    );
    const proposed = await ctx.storage.store(
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: "image/jpeg" }),
    );
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      image: art,
      createdAt: now,
      updatedAt: now,
    });
    const proposalId = await ctx.db.insert("puzzleChangeProposals", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: definitionId,
      proposedBy: bob,
      status: "pending",
      changes: { image: proposed },
      baseline: { image: art },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, art, proposed, puzzleId, proposalId };
  });

const run = (
  t: TestConvex<typeof schema>,
  table: "boxArt" | "proposals",
  dryRun?: boolean,
) =>
  t.action(
    internal.lib.imageModeration.backfillBoxArtHashCheck
      .backfillBoxArtHashCheck,
    { table, ...(dryRun === undefined ? {} : { dryRun }) },
  );

const listings = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("boxArtUploads").collect());
const escalations = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("csamEscalations").collect());
const blobExists = (t: TestConvex<typeof schema>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

describe("backfillBoxArtHashCheck", () => {
  test("defaults to a dry run: counts the unchecked box art, calls nothing, writes nothing", async () => {
    const fetchMock = hcs("match");
    const t = convexTest(schema, modules);
    await seed(t);

    expect(await run(t, "boxArt")).toMatchObject({
      scanned: 1,
      unchecked: 1,
      matched: 0,
    });
    expect(await run(t, "proposals")).toMatchObject({ unchecked: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listings(t)).toEqual([]);
    expect(await escalations(t)).toEqual([]);
  });

  test("a match on a definition's box art: quarantined, preserved, detached and escalated like the live pipeline", async () => {
    hcs("match");
    const t = convexTest(schema, modules);
    const { alice, art, puzzleId, proposalId } = await seed(t);

    expect(await run(t, "boxArt", false)).toMatchObject({
      unchecked: 1,
      matched: 1,
    });

    const [listing] = await listings(t);
    expect(listing.moderationStatus).toBe("quarantined");
    expect(listing.storageId).not.toBe(art);
    const [escalation] = await escalations(t);
    expect(escalation).toMatchObject({
      table: "boxArtUploads",
      rowId: listing._id,
      uploaderId: alice,
      fileId: listing.storageId,
      md5: createHash("md5").update(ART).digest("hex"),
      sha1: createHash("sha1").update(ART).digest("hex"),
      originalDiscarded: true,
      status: "open",
    });
    expect(await blobExists(t, listing.storageId)).toBe(true);
    expect(await blobExists(t, art)).toBe(false);
    const puzzle = await t.run((ctx) => ctx.db.get(puzzleId));
    expect(puzzle?.image).toBeUndefined();
    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal?.baseline.image).toBeUndefined();
    expect(
      await t.query(api.catalog.getPuzzleById.getPuzzleById, { puzzleId }),
    ).toMatchObject({ image: null });
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps).toEqual([
      expect.objectContaining({
        kind: "image_quarantined",
        targetLabel: "Box art",
      }),
    ]);
  });

  test("a match on a proposed box art detaches it from the proposal", async () => {
    hcs("match");
    const t = convexTest(schema, modules);
    const { bob, proposed, proposalId, puzzleId } = await seed(t);

    expect(await run(t, "proposals", false)).toMatchObject({ matched: 1 });

    expect((await escalations(t))[0].uploaderId).toBe(bob);
    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal?.changes.image).toBeUndefined();
    expect(await blobExists(t, proposed)).toBe(false);
    // The definition's own art was not part of this run.
    expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBeDefined();
  });

  test("no_match is recorded, the art stays served, and a re-run skips it", async () => {
    hcs("no_match");
    const t = convexTest(schema, modules);
    const { art, puzzleId } = await seed(t);

    expect(await run(t, "boxArt", false)).toMatchObject({ noMatch: 1 });

    expect(await listings(t)).toMatchObject([
      { storageId: art, hashCheckedAt: expect.any(Number) },
    ]);
    expect(
      (await t.query(api.catalog.getPuzzleById.getPuzzleById, { puzzleId }))
        ?.image,
    ).toMatch(/^https?:\/\//);
    expect(await run(t, "boxArt")).toMatchObject({ unchecked: 0, skipped: 1 });
  });

  test("unavailable changes nothing and is counted", async () => {
    hcs(503);
    const t = convexTest(schema, modules);
    await seed(t);

    expect(await run(t, "boxArt", false)).toMatchObject({ unavailable: 1 });
    expect(await listings(t)).toEqual([]);
    expect(await escalations(t)).toEqual([]);
  });

  test("a real run refuses to start without a configured hash service", async () => {
    vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(run(t, "boxArt", false)).rejects.toThrow(/not configured/);
  });
});
