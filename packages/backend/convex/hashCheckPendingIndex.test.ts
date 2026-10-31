import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { HASH_CHECK_WAITING_CAP } from "./admin/listCsamEscalations";
import { isHashCleared } from "./lib/imageModeration/hashCheckFields";
import schema from "./schema";

// SEC-55: the `by_hash_check_pending` index holds the photos whose CSAM hash check has not
// passed. A refused upload (rejected as "invalid_image", its blob deleted) is never published and
// never re-checked, so it must leave the index; and the admin's "N photos waiting" count must not
// be hidden behind rows it does not count (refused rows from before this fix, quarantined rows,
// timed-out rows an admin rejected). The classifier (Hugging Face) and the hash service
// (Offlimits HCS) are a routed fake `fetch`.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

// HCS's verdict, or an HTTP status (503: the hash service is down).
const fakes: { hcs: "no_match" | number } = { hcs: "no_match" };

beforeEach(() => {
  fakes.hcs = "no_match";
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === HCS_URL) {
        return typeof fakes.hcs === "number"
          ? new Response("unavailable", { status: fakes.hcs })
          : new Response(JSON.stringify({ match: false }), { status: 200 });
      }
      if (url.includes(HF_HOST)) {
        return new Response(JSON.stringify([{ label: "nsfw", score: 0.01 }]), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
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
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["placeholder"], { type: "image/jpeg" }),
    );
    return { alice, copy, fileId };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const pendingIndexIds = (t: T) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .collect()
    ).map((row) => row._id),
  );

// Bytes that announce no supported image format: the input guards refuse them.
const uploadGarbage = async (t: T, copy: Id<"ownedPuzzles">) => {
  const fileId = (await t.run((ctx) =>
    ctx.storage.store(
      new Blob([new TextEncoder().encode("definitely not an image")], {
        type: "image/jpeg",
      }),
    ),
  )) as Id<"_storage">;
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId,
    tag: "box_front",
  });
  await settleDueScheduled(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return { row, fileId };
};

describe("a refused upload leaves the hash-pending index", () => {
  test.each([
    ["the hash service answers no match", "no_match" as const],
    ["the hash service is down", 503],
  ])(
    "%s: rejected as an invalid image, its blob deleted, out of the index",
    async (_label, hcs) => {
      fakes.hcs = hcs;
      const t = withModerationPool(convexTest(schema, modules));
      const { copy } = await seed(t);

      const { row, fileId } = await uploadGarbage(t, copy);

      expect(row).toMatchObject({
        moderationStatus: "rejected",
        moderationLabel: "invalid_image",
      });
      expect(await blobExists(t, fileId)).toBe(false);
      // Never published, never re-checked: nothing waits on its hash check.
      expect(row.hashCheckPendingSince).toBeUndefined();
      expect(row.hashCheckedAt).toBeUndefined();
      expect(row.pendingHashes).toBeUndefined();
      expect(await pendingIndexIds(t)).toEqual([]);
    },
  );
});

describe("the refused outcome only clears a refused row that owes no hash check", () => {
  const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];

  const insertRow = (
    t: T,
    s: { alice: Id<"users">; copy: Id<"ownedPuzzles">; fileId: Id<"_storage"> },
    fields: Partial<Doc<"ownedPuzzleImages">>,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: s.copy,
        uploaderId: s.alice,
        fileId: s.fileId,
        hashCheckPendingSince: 1_000,
        createdAt: 1_000,
        updatedAt: 1_000,
        ...fields,
      }),
    );

  test.each<[string, Partial<Doc<"ownedPuzzleImages">>, boolean]>([
    [
      "a refused row",
      { moderationStatus: "rejected", moderationLabel: "invalid_image" },
      true,
    ],
    [
      "a refused row whose stored hashes still wait on a re-check",
      {
        moderationStatus: "rejected",
        moderationLabel: "invalid_image",
        pendingHashes: HASHES,
      },
      false,
    ],
    [
      "a row the classifier rejected",
      { moderationStatus: "rejected", moderationLabel: "nsfw" },
      false,
    ],
    ["an approved row", { moderationStatus: "approved" }, false],
    ["a pending row", { moderationStatus: "pending" }, false],
    [
      "a quarantined row",
      { moderationStatus: "quarantined", moderationLabel: "invalid_image" },
      false,
    ],
  ])("%s", async (_label, fields, cleared) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const imageId = await insertRow(t, s, fields);

    await t.mutation(internal.library.moderationStore.setHashCheck, {
      imageId,
      status: "refused",
    });

    const row = await t.run((ctx) => ctx.db.get(imageId));
    expect(row!.hashCheckPendingSince).toBe(cleared ? undefined : 1_000);
    // Refusing never opens the gate, nor drops hashes a re-check still needs.
    expect(row!.hashCheckedAt).toBeUndefined();
    expect(row!.pendingHashes).toEqual(fields.pendingHashes);
  });
});

// A quarantined photo is never served, whatever its hash-check fields say (isHashCleared), and
// never leaves quarantine: it waits on nothing, so it leaves the index the moment it is
// quarantined, in every image table.
describe("a quarantined photo leaves the hash-pending index, its gate still closed", () => {
  const MATCH = {
    md5: "c".repeat(32),
    sha1: "d".repeat(40),
    provider: "offlimits",
    originalDiscarded: false,
  };

  // Each table's photo, waiting on its hash check, and its store's quarantine step.
  const tables = {
    copy: async (t: T, s: Awaited<ReturnType<typeof seed>>) => {
      const imageId = await t.run((ctx) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: s.copy,
          uploaderId: s.alice,
          fileId: s.fileId,
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        }),
      );
      await t.mutation(internal.library.moderationStore.quarantineImage, {
        imageId,
        uploaderId: s.alice,
        ...MATCH,
      });
      return t.run((ctx) => ctx.db.get(imageId));
    },
    completion: async (t: T, s: Awaited<ReturnType<typeof seed>>) => {
      const imageId = await t.run((ctx) =>
        ctx.db.insert("completionImages", {
          completionId: crypto.randomUUID(),
          uploaderId: s.alice,
          fileId: s.fileId,
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        }),
      );
      await t.mutation(
        internal.solving.completionModerationStore.quarantineImage,
        { imageId, uploaderId: s.alice, ...MATCH },
      );
      return t.run((ctx) => ctx.db.get(imageId));
    },
    message: async (t: T, s: Awaited<ReturnType<typeof seed>>) => {
      const imageId = await t.run((ctx) =>
        ctx.db.insert("messageAttachments", {
          kind: "image",
          threadAggregateId: crypto.randomUUID(),
          uploaderId: s.alice,
          fileId: s.fileId,
          byteSize: 11,
          contentType: "image/jpeg",
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        }),
      );
      await t.mutation(
        internal.conversation.attachmentModerationStore.quarantineImage,
        { imageId, uploaderId: s.alice, ...MATCH },
      );
      const row = await t.run((ctx) => ctx.db.get(imageId));
      // (The table also holds shared locations, which carry no hash-check fields.)
      if (row?.kind === "location") throw new Error("expected a photo");
      return row;
    },
    boxArt: async (t: T, s: Awaited<ReturnType<typeof seed>>) => {
      const imageId = await t.run((ctx) =>
        ctx.db.insert("boxArtUploads", {
          storageId: s.fileId,
          uploaderId: s.alice,
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
        }),
      );
      await t.mutation(internal.catalog.boxArtModerationStore.quarantine, {
        imageId,
        uploaderId: s.alice,
        ...MATCH,
      });
      return t.run((ctx) => ctx.db.get(imageId));
    },
    circleIcon: async (t: T, s: Awaited<ReturnType<typeof seed>>) => {
      const imageId = await t.run((ctx) =>
        ctx.db.insert("circleIcons", {
          circleId: crypto.randomUUID(),
          uploaderId: s.alice,
          fileId: s.fileId,
          moderationStatus: "approved",
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        }),
      );
      await t.mutation(internal.sharing.circleIconModerationStore.quarantine, {
        imageId,
        uploaderId: s.alice,
        ...MATCH,
      });
      return t.run((ctx) => ctx.db.get(imageId));
    },
  };

  test.each(Object.keys(tables) as (keyof typeof tables)[])(
    "%s",
    async (table) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);

      const row = await tables[table](t, s);
      if (!row) throw new Error("the quarantined row is gone");

      expect(row.moderationStatus).toBe("quarantined");
      expect(row.hashCheckPendingSince).toBeUndefined();
      expect(row.hashCheckedAt).toBeUndefined();
      expect(isHashCleared(row)).toBe(false);
    },
  );
});

describe("the admin's waiting count is never hidden behind rows it does not count", () => {
  test("refused rows from before this fix, quarantined rows and rejected timed-out rows fill the first page", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];
    await t.run(async (ctx) => {
      const base = {
        ownedPuzzleId: s.copy,
        uploaderId: s.alice,
        fileId: s.fileId,
        createdAt: 1_000,
        updatedAt: 1_000,
      };
      // More than a page of refused uploads that kept their place in the index (as every one did
      // before this fix): rejected, nothing stored, no hashes.
      for (let i = 0; i < HASH_CHECK_WAITING_CAP + 50; i++) {
        await ctx.db.insert("ownedPuzzleImages", {
          ...base,
          moderationStatus: "rejected",
          moderationLabel: "invalid_image",
          hashCheckPendingSince: 1_000 + i,
        });
      }
      await ctx.db.insert("ownedPuzzleImages", {
        ...base,
        moderationStatus: "quarantined",
        hashCheckPendingSince: 1_500,
      });
      // Timed out, then rejected by an admin: decided, so neither waiting nor timed out.
      await ctx.db.insert("ownedPuzzleImages", {
        ...base,
        moderationStatus: "rejected",
        pendingHashes: HASHES,
        hashCheckPendingSince: 1_600,
        hashCheckTimedOutAt: 2_000,
      });
      // The two the tab must count: one waiting on a re-check, one timed out and undecided.
      await ctx.db.insert("ownedPuzzleImages", {
        ...base,
        moderationStatus: "approved",
        pendingHashes: HASHES,
        hashCheckPendingSince: 5_000,
      });
      await ctx.db.insert("ownedPuzzleImages", {
        ...base,
        moderationStatus: "unscored",
        pendingHashes: HASHES,
        hashCheckPendingSince: 6_000,
        hashCheckTimedOutAt: 7_000,
      });
    });

    const { hashCheck } = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );

    expect(hashCheck).toMatchObject({
      waitingPhotos: 1,
      oldestWaitingSince: 5_000,
      timedOutPhotos: 1,
      waitingCapped: false,
    });
  });

  // The count is capped per table, so only a table that hit its cap makes it "N+": an exact total
  // above the cap, spread over tables that each stayed under it, is exact.
  const insertWaiting = (
    t: T,
    s: Awaited<ReturnType<typeof seed>>,
    n: number,
  ) =>
    t.run(async (ctx) => {
      const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: s.copy,
          uploaderId: s.alice,
          fileId: s.fileId,
          moderationStatus: "approved",
          pendingHashes: HASHES,
          hashCheckPendingSince: 1_000 + i,
          createdAt: 1_000,
          updatedAt: 1_000,
        });
        await ctx.db.insert("boxArtUploads", {
          storageId: s.fileId,
          uploaderId: s.alice,
          moderationStatus: "approved",
          pendingHashes: HASHES,
          hashCheckPendingSince: 1_000 + i,
          createdAt: 1_000,
        });
      }
    });

  test("an exact total above the cap, with no table at it, is not capped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertWaiting(t, s, HASH_CHECK_WAITING_CAP - 75);

    const { hashCheck } = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );

    expect(hashCheck.waitingPhotos).toBe(2 * (HASH_CHECK_WAITING_CAP - 75));
    expect(hashCheck.waitingPhotos).toBeGreaterThanOrEqual(
      HASH_CHECK_WAITING_CAP,
    );
    expect(hashCheck.waitingCapped).toBe(false);
  });

  test("a table at its cap makes the count capped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertWaiting(t, s, HASH_CHECK_WAITING_CAP);

    const { hashCheck } = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );

    expect(hashCheck.waitingPhotos).toBe(2 * HASH_CHECK_WAITING_CAP);
    expect(hashCheck.waitingCapped).toBe(true);
  });
});

// The one-shot for rows settled before the pipeline cleared the field itself: quarantined rows and
// refused uploads whose blob is gone leave the index; everything that may still need the field
// keeps it.
describe("the one-shot clearSettledHashPending", () => {
  const HASHES = [{ md5: "a".repeat(32), sha1: "b".repeat(40) }];

  const seedIndex = async (t: T) => {
    const s = await seed(t);
    return t.run(async (ctx) => {
      const gone = await ctx.storage.store(
        new Blob(["refused"], { type: "image/jpeg" }),
      );
      await ctx.storage.delete(gone);
      const copy = (fields: Partial<Doc<"ownedPuzzleImages">>) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: s.copy,
          uploaderId: s.alice,
          fileId: s.fileId,
          hashCheckPendingSince: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
          ...fields,
        });
      const refused = {
        moderationStatus: "rejected",
        moderationLabel: "invalid_image",
      } as const;
      return {
        settled: {
          quarantined: await copy({ moderationStatus: "quarantined" }),
          refused: await copy({ ...refused, fileId: gone }),
          refusedBoxArt: await ctx.db.insert("boxArtUploads", {
            storageId: gone,
            uploaderId: s.alice,
            ...refused,
            hashCheckPendingSince: 1_000,
            createdAt: 1_000,
          }),
          quarantinedMessage: await ctx.db.insert("messageAttachments", {
            kind: "image",
            threadAggregateId: crypto.randomUUID(),
            uploaderId: s.alice,
            fileId: s.fileId,
            byteSize: 11,
            contentType: "image/jpeg",
            moderationStatus: "quarantined",
            hashCheckPendingSince: 1_000,
            createdAt: 1_000,
            updatedAt: 1_000,
          }),
        },
        kept: {
          // restorePhoto could publish it: the field keeps its gate closed.
          refusedBlobStored: await copy({ ...refused }),
          // A re-check still needs it (a match escalates even a refused upload).
          refusedWithHashes: await copy({
            ...refused,
            fileId: gone,
            pendingHashes: HASHES,
          }),
          waiting: await copy({
            moderationStatus: "approved",
            pendingHashes: HASHES,
          }),
          notReachedYet: await copy({ moderationStatus: "pending" }),
          rejectedAfterTimeout: await copy({
            moderationStatus: "rejected",
            pendingHashes: HASHES,
            hashCheckTimedOutAt: 2_000,
          }),
          circleIconWaiting: await ctx.db.insert("circleIcons", {
            circleId: crypto.randomUUID(),
            uploaderId: s.alice,
            fileId: s.fileId,
            moderationStatus: "approved",
            pendingHashes: HASHES,
            hashCheckPendingSince: 1_000,
            createdAt: 1_000,
            updatedAt: 1_000,
          }),
        },
      };
    });
  };

  type PhotoId =
    | Id<"ownedPuzzleImages">
    | Id<"boxArtUploads">
    | Id<"messageAttachments">
    | Id<"circleIcons">;
  const pendingOf = (t: T, ids: Record<string, PhotoId>) =>
    t.run(async (ctx) => {
      const out: Record<string, number | undefined> = {};
      for (const [name, id] of Object.entries(ids)) {
        const row = await ctx.db.get(id);
        // (A shared location carries no hash-check fields.)
        out[name] =
          row && "hashCheckPendingSince" in row
            ? row.hashCheckPendingSince
            : undefined;
      }
      return out;
    });
  const everyPending = (ids: Record<string, unknown>, value?: number) =>
    Object.fromEntries(Object.keys(ids).map((name) => [name, value]));

  const run = (t: T, args: { dryRun?: boolean; batchSize?: number } = {}) =>
    t.mutation(
      internal.lib.imageModeration.clearSettledHashPending
        .clearSettledHashPending,
      args,
    );

  // The last run event's running totals (logEvent writes one JSON line per page).
  const lastTotals = () => {
    const lines = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .filter((line) =>
        line.includes("imageModeration.clearSettledHashPending"),
      )
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return lines[lines.length - 1];
  };

  test("the dry run (the default) counts the settled rows of every table and changes nothing", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const rows = await seedIndex(t);

    await run(t, { batchSize: 2 });
    await settleDueScheduled(t);

    expect(lastTotals()).toMatchObject({
      dry_run: true,
      done: true,
      scanned: 10,
      settled: 4,
      cleared: 0,
    });
    expect(await pendingOf(t, rows.settled)).toEqual(
      everyPending(rows.settled, 1_000),
    );
    expect(await pendingOf(t, rows.kept)).toEqual(
      everyPending(rows.kept, 1_000),
    );
  });

  test("a real run clears exactly the settled rows, opens no gate, and a re-run finds none", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const rows = await seedIndex(t);

    await run(t, { dryRun: false, batchSize: 2 });
    await settleDueScheduled(t);

    expect(lastTotals()).toMatchObject({
      dry_run: false,
      done: true,
      scanned: 10,
      settled: 4,
      cleared: 4,
    });
    expect(await pendingOf(t, rows.settled)).toEqual(
      everyPending(rows.settled, undefined),
    );
    expect(await pendingOf(t, rows.kept)).toEqual(
      everyPending(rows.kept, 1_000),
    );
    // Only the field moved: the quarantined photo stays unservable, the refused one rejected.
    const [quarantined, refused] = await t.run(async (ctx) => [
      await ctx.db.get(rows.settled.quarantined),
      await ctx.db.get(rows.settled.refused),
    ]);
    expect(quarantined!.moderationStatus).toBe("quarantined");
    expect(isHashCleared(quarantined!)).toBe(false);
    expect(refused!.moderationStatus).toBe("rejected");
    expect(refused!.hashCheckedAt).toBeUndefined();

    await run(t, { dryRun: false });
    await settleDueScheduled(t);
    expect(lastTotals()).toMatchObject({ done: true, scanned: 6, settled: 0 });
  });
});
