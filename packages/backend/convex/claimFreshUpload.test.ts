import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-01 / SEC-18: a copy or completion photo may only claim a FRESH upload that nothing holds
// yet. A storage id someone learned (box art, another member's photo, a preserved blob) or a blob
// already used once (crashed in its check, refused, removed) can never be attached, so it can
// neither be destroyed through the attacker's own row nor fed to the moderation pool again.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "none");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const HOUR = 60 * 60 * 1000;

const seed = (t: T) =>
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
    // The catalogue puzzle's box art: a stored blob whose id reaches members (SEC-01).
    const boxArt = await ctx.storage.store(
      new Blob(["box art"], { type: "image/jpeg" }),
    );
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      image: boxArt,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = async (ownerId: Id<"users">) => {
      const aggregateId = crypto.randomUUID();
      const id = await ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleDefinitionId: definitionId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        visibility: "private",
        snapshot: { title: "Mountain Vista", pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
      });
      return { id, aggregateId };
    };
    return {
      alice,
      bob,
      boxArt,
      puzzleId,
      aliceCopy: await mkCopy(alice),
      bobCopy: await mkCopy(bob),
    };
  });

const as = (t: T, who: "alice" | "bob") =>
  t.withIdentity({ subject: `clerk_${who}` });

const recordCompletion = async (t: T, who: "alice" | "bob", copyId: string) =>
  (
    await as(t, who).mutation(api.solving.recordCompletion.recordCompletion, {
      copyId,
      startDate: Date.now() - 2 * HOUR,
      endDate: Date.now() - HOUR,
    })
  ).completionId;

// Unique, non-image bytes: the pipeline's input guards refuse them.
const storeBytes = (t: T) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/png" }),
      ) as Promise<Id<"_storage">>,
  );

// A real 2x2 PNG (as in completionModeration.test.ts): it passes the input guards and is approved,
// and the pipeline swaps the row to its re-encode, so the upload's id does not stay attached.
const storePng = async (t: T) => {
  const png = await new Jimp({
    width: 2,
    height: 2,
    color: 0x00000080,
  }).getBuffer("image/png");
  return t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(png)], { type: "image/png" }),
      ) as Promise<Id<"_storage">>,
  );
};

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

// The ConvexError's data of a refused call.
const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) {
      return error.data as { code?: string; message?: string };
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

const addCopyPhoto = (
  t: T,
  who: "alice" | "bob",
  copyId: Id<"ownedPuzzles">,
  fileId: Id<"_storage">,
) =>
  as(t, who).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId,
    fileId,
  });

const attachCompletionPhotos = (
  t: T,
  who: "alice" | "bob",
  completionId: string,
  storageIds: Id<"_storage">[],
) =>
  as(t, who).mutation(
    api.solving.attachCompletionPhotos.attachCompletionPhotos,
    { completionId, storageIds },
  );

const copyPhotos = (t: T) =>
  t.run((ctx) => ctx.db.query("ownedPuzzleImages").collect());
const completionPhotos = (t: T) =>
  t.run((ctx) => ctx.db.query("completionImages").collect());

describe("claiming an upload as a copy or completion photo", () => {
  test("a fresh upload nothing holds is accepted on both paths", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const forCopy = await storeBytes(t);
    const forCompletion = await storeBytes(t);

    await addCopyPhoto(t, "alice", aliceCopy.id, forCopy);
    await attachCompletionPhotos(t, "alice", completionId, [forCompletion]);

    expect((await copyPhotos(t)).map((p) => [p.fileId, p.uploaderId])).toEqual([
      [forCopy, alice],
    ]);
    expect(
      (await completionPhotos(t)).map((p) => [p.fileId, p.uploaderId]),
    ).toEqual([[forCompletion, alice]]);
    await settleDueScheduled(t);
  });

  test("leaked box art is refused on both paths and survives", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { boxArt, puzzleId, bobCopy } = await seed(t);
    const completionId = await recordCompletion(t, "bob", bobCopy.aggregateId);

    expect(
      (await refusalOf(addCopyPhoto(t, "bob", bobCopy.id, boxArt))).code,
    ).toBe("InvalidUpload");
    expect(
      (
        await refusalOf(
          attachCompletionPhotos(t, "bob", completionId, [boxArt]),
        )
      ).code,
    ).toBe("InvalidUpload");

    await settleDueScheduled(t);
    expect(await blobExists(t, boxArt)).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBe(boxArt);
    expect(await copyPhotos(t)).toEqual([]);
    expect(await completionPhotos(t)).toEqual([]);
  });

  test("a photo already attached elsewhere is refused on both paths", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy, bobCopy } = await seed(t);
    const bobCompletion = await recordCompletion(t, "bob", bobCopy.aggregateId);
    const alicePhoto = await storePng(t);
    await addCopyPhoto(t, "alice", aliceCopy.id, alicePhoto);

    expect(
      (await refusalOf(addCopyPhoto(t, "bob", bobCopy.id, alicePhoto))).code,
    ).toBe("InvalidUpload");
    expect(
      (
        await refusalOf(
          attachCompletionPhotos(t, "bob", bobCompletion, [alicePhoto]),
        )
      ).code,
    ).toBe("InvalidUpload");
    // Not even its own uploader can attach it a second time.
    expect(
      (await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, alicePhoto)))
        .code,
    ).toBe("InvalidUpload");
    await settleDueScheduled(t);
    expect((await copyPhotos(t)).map((p) => p.ownedPuzzleId)).toEqual([
      aliceCopy.id,
    ]);
  });

  test("a stale upload is refused as UploadExpired and left alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const old = await storeBytes(t);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);

    expect(
      (await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, old))).code,
    ).toBe("UploadExpired");
    expect(
      (await refusalOf(attachCompletionPhotos(t, "alice", completionId, [old])))
        .code,
    ).toBe("UploadExpired");
    // Never deleted on request: it may be held where no index can tell (a legacy completion
    // photo), and deleting it on request would let anyone destroy it.
    expect(await blobExists(t, old)).toBe(true);
    expect(await copyPhotos(t)).toEqual([]);
    expect(await completionPhotos(t)).toEqual([]);
  });

  test("a preserved blob gets the same refusal as a missing one", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const missing = await storeBytes(t);
    await t.run((ctx) => ctx.storage.delete(missing));
    const preserved = await storeBytes(t);
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "ownedPuzzleImages",
        rowId: "row",
        uploaderId: alice,
        fileId: preserved,
        md5: "md5",
        sha1: "sha1",
        provider: "offlimits",
        matchedAt: Date.now(),
        status: "open",
      }),
    );

    const missingCopy = await refusalOf(
      addCopyPhoto(t, "alice", aliceCopy.id, missing),
    );
    expect(missingCopy.code).toBe("InvalidUpload");
    expect(
      await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, preserved)),
    ).toEqual(missingCopy);
    expect(
      await refusalOf(
        attachCompletionPhotos(t, "alice", completionId, [preserved]),
      ),
    ).toEqual(
      await refusalOf(
        attachCompletionPhotos(t, "alice", completionId, [missing]),
      ),
    );
    expect(await blobExists(t, preserved)).toBe(true);
  });

  test("one unclaimable id refuses the whole completion attach", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { boxArt, aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const fresh = await storeBytes(t);

    expect(
      (
        await refusalOf(
          attachCompletionPhotos(t, "alice", completionId, [fresh, boxArt]),
        )
      ).code,
    ).toBe("InvalidUpload");
    expect(await completionPhotos(t)).toEqual([]);
    const row = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(row?.photos).toEqual([]);
  });

  test("re-sending an attached completion photo stays a no-op", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const upload = await storePng(t);

    await attachCompletionPhotos(t, "alice", completionId, [upload]);
    await settleDueScheduled(t);
    // Every accepted image is stored as its re-encode: this is the id the completion holds now.
    const [{ fileId: photo }] = await completionPhotos(t);
    expect(photo).not.toBe(upload);
    await attachCompletionPhotos(t, "alice", completionId, [photo, photo]);

    expect((await completionPhotos(t)).map((p) => p.fileId)).toEqual([photo]);
  });
});

describe("SEC-18: a blob that was used once cannot be attached again", () => {
  test("a photo whose check crashed (left pending, then unscored)", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const crashed = await storeBytes(t);
    // What an attempt killed by the runtime (OOM) leaves: the row pending, its blob intact.
    const rowId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: aliceCopy.id,
        uploaderId: alice,
        fileId: crashed,
        moderationStatus: "pending",
        hashCheckPendingSince: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    for (const status of ["pending", "unscored"] as const) {
      await t.run((ctx) => ctx.db.patch(rowId, { moderationStatus: status }));
      expect(
        (await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, crashed))).code,
      ).toBe("InvalidUpload");
      expect(
        (
          await refusalOf(
            attachCompletionPhotos(t, "alice", completionId, [crashed]),
          )
        ).code,
      ).toBe("InvalidUpload");
    }
    expect(await copyPhotos(t)).toHaveLength(1);
    expect(await completionPhotos(t)).toEqual([]);
  });

  test("a photo the pipeline refused", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const refused = await storeBytes(t);
    await addCopyPhoto(t, "alice", aliceCopy.id, refused);
    await settleDueScheduled(t);
    const [row] = await copyPhotos(t);
    expect(row.moderationStatus).toBe("rejected");

    expect(
      (await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, refused))).code,
    ).toBe("InvalidUpload");
    expect(
      (
        await refusalOf(
          attachCompletionPhotos(t, "alice", completionId, [refused]),
        )
      ).code,
    ).toBe("InvalidUpload");
  });

  test("a removed photo's blob", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, aliceCopy } = await seed(t);
    const completionId = await recordCompletion(
      t,
      "alice",
      aliceCopy.aggregateId,
    );
    const removed = await storeBytes(t);
    const imageId = await t.run((ctx) =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: aliceCopy.id,
        uploaderId: alice,
        fileId: removed,
        moderationStatus: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await as(t, "alice").mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId,
    });

    expect(
      (await refusalOf(addCopyPhoto(t, "alice", aliceCopy.id, removed))).code,
    ).toBe("InvalidUpload");
    expect(
      (
        await refusalOf(
          attachCompletionPhotos(t, "alice", completionId, [removed]),
        )
      ).code,
    ).toBe("InvalidUpload");
  });
});
