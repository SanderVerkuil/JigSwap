import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  asImage,
  UNCHECKED_SENT_PHOTO_TTL_MS,
} from "./conversation/messageAttachments";
import { DAY_MS, RETENTION_SWEEP_PAGE } from "./lib/retention";
import { REJECTED_COPY_PHOTO_TTL_MS } from "./library/moderationStore";
import schema from "./schema";

// The stated photo retention (privacy policy, "How long we keep data"; SEC-67), enforced by two
// daily sweeps that are DRY-RUN unless RETENTION_ENFORCE names them (lib/retention):
// - "sentPhotos" (conversation/attachmentModerationStore.sweepUncheckedSentPhotos): a photo sent
//   while still being checked that is still being checked a week later is deleted; its message
//   then reads "Photo no longer available" for both members.
// - "copyPhotos" (library/moderationStore.sweepRejectedCopyPhotos): a copy photo the automated
//   check rejected is deleted 30 days after the rejection.
// Neither ever touches a photo an open report holds, or one whose CSAM hash check has not
// finished (a late match must still find the bytes to preserve).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

// Every logged line (info and error levels alike).
let lines: string[] = [];
const sweepEvents = (sweep: string) =>
  lines
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((event) => event.event === "retention.sweep")
    .filter((event) => event.sweep === sweep);

// The last page's event of a sweep run.
const lastPage = (sweep: string) => sweepEvents(sweep).slice(-1)[0];

beforeEach(() => {
  lines = [];
  const capture = (line: unknown) => {
    lines.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

// Run every scheduled job that is due now, the sweep's own next pages included.
const flush = async (t: T) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const seedUsers = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    await mkUser("clerk_ada");
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 1,
    });
    return { alice, bob };
  });

describe("sent photos still being checked a week later", () => {
  const BLURHASH = "LKO2?U%2Tw=w]~RBVZRi};RPxuwH";

  // Alice and Bob's DM.
  const openThread = async (t: T) => {
    const users = await seedUsers(t);
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: users.bob },
    );
    return { ...users, threadId };
  };

  // A photo Alice sent while it was still being checked: it became an image message at once
  // (sendStagedImages), then stayed `status` (default "unscored": the check could not run).
  const sendPhoto = async (
    t: T,
    world: { alice: Id<"users">; threadId: string },
    opts: {
      status?: "pending" | "unscored" | "approved";
      hashCleared?: boolean;
      caption?: string;
    } = {},
  ) => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: world.threadId,
        uploaderId: world.alice,
        fileId: await ctx.storage.store(new Blob(["x"])),
        width: 4,
        height: 3,
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: "pending",
        blurhash: BLURHASH,
        reencodedAt: 1,
        ...(opts.hashCleared === false
          ? { hashCheckPendingSince: 1 }
          : { hashCheckedAt: 1 }),
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await asAlice(t).mutation(
      api.conversation.sendStagedImages.sendStagedImages,
      {
        threadId: world.threadId,
        attachmentIds: [id],
        ...(opts.caption !== undefined && { caption: opts.caption }),
      },
    );
    await t.run((ctx) =>
      ctx.db.patch(id, {
        moderationStatus: opts.status ?? "unscored",
        updatedAt: 1,
      }),
    );
    return id;
  };

  const rowOf = (t: T, id: Id<"messageAttachments">) =>
    t.run(async (ctx) => asImage(await ctx.db.get(id)));

  const threadView = (
    t: T,
    as: (t: T) => ReturnType<T["withIdentity"]>,
    threadId: string,
  ) =>
    as(t).query(api.conversation.getThreadMessages.getThreadMessages, {
      threadId,
    });

  // A sweep run as the cron starts it, `now` being 8 days after the sends.
  const weekAndADayLater = () =>
    Date.now() + UNCHECKED_SENT_PHOTO_TTL_MS + DAY_MS;
  const sweep = async (t: T, now = weekAndADayLater()) => {
    await t.mutation(
      internal.conversation.attachmentModerationStore.sweepUncheckedSentPhotos,
      { now },
    );
    await flush(t);
  };

  test("dry run (RETENTION_ENFORCE unset): counted, nothing changes", async () => {
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const id = await sendPhoto(t, world, { caption: "Look" });
    const before = await rowOf(t, id);

    await sweep(t);

    expect(await rowOf(t, id)).toEqual(before);
    expect(await blobExists(t, before!.fileId)).toBe(true);
    expect(
      sweepEvents("sentPhotos").map((e) => [
        e.phase,
        e.due,
        e.acted,
        e.dry_run,
      ]),
    ).toEqual([
      ["pending", 0, 0, true],
      ["unscored", 1, 0, true],
    ]);
  });

  test("enforced: the photo goes, both members read 'no longer available', the caption stays", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "sentPhotos");
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const id = await sendPhoto(t, world, { caption: "Look" });
    const { fileId } = (await rowOf(t, id))!;
    const queued = async () =>
      (
        await asAdmin(t).query(
          api.admin.listUncheckedPhotos.listUncheckedPhotos,
          {},
        )
      ).some((item) => item.key === `message:${id}`);
    expect(await queued()).toBe(true);

    await sweep(t);

    const row = await rowOf(t, id);
    expect(row).toMatchObject({
      moderationStatus: "removed",
      removedReason: "expired",
    });
    // Nothing of the image stays: no blob, no blurhash; only its size for the placeholder.
    expect(row).not.toHaveProperty("blurhash");
    expect(await blobExists(t, fileId)).toBe(false);
    for (const as of [asBob, asAlice]) {
      const [message] = await threadView(t, as, world.threadId);
      expect(message.attachment).toEqual({
        status: "removed",
        w: 4,
        h: 3,
        unavailable: true,
      });
      expect(message.body).toBe("Look");
    }
    // Out of the admin's Unchecked photos queue.
    expect(await queued()).toBe(false);
    expect(lastPage("sentPhotos")).toMatchObject({
      phase: "unscored",
      due: 1,
      acted: 1,
      dry_run: false,
      is_done: true,
    });
  });

  test("a stalled 'pending' photo goes too; one being checked right now is left", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "all");
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const stalled = await sendPhoto(t, world, { status: "pending" });
    const inFlight = await sendPhoto(t, world, { status: "pending" });
    const now = weekAndADayLater();
    // An admin's "Check again" turned it pending an hour ago.
    await t.run((ctx) =>
      ctx.db.patch(inFlight, { updatedAt: now - 3_600_000 }),
    );

    await sweep(t, now);

    expect(await rowOf(t, stalled)).toMatchObject({
      moderationStatus: "removed",
      removedReason: "expired",
    });
    expect(await rowOf(t, inFlight)).toMatchObject({
      moderationStatus: "pending",
    });
  });

  test("kept: inside the week, checked, held by an open report, or its hash check not done", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "sentPhotos");
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const now = weekAndADayLater();
    const recent = await sendPhoto(t, world);
    await t.run((ctx) =>
      ctx.db.patch(recent, { sendRequestedAt: now - DAY_MS }),
    );
    const approved = await sendPhoto(t, world, { status: "approved" });
    const reported = await sendPhoto(t, world);
    await t.run((ctx) => ctx.db.patch(reported, { evidenceHold: true }));
    const hashPending = await sendPhoto(t, world, { hashCleared: false });

    await sweep(t, now);

    for (const [id, status] of [
      [recent, "unscored"],
      [approved, "approved"],
      [reported, "unscored"],
      [hashPending, "unscored"],
    ] as const) {
      const row = await rowOf(t, id);
      expect(row?.moderationStatus).toBe(status);
      expect(await blobExists(t, row!.fileId)).toBe(true);
    }
    expect(lastPage("sentPhotos")).toMatchObject({
      phase: "unscored",
      due: 0,
      acted: 0,
      held_report: 1,
      held_hash_check: 1,
    });
  });

  test("a sent photo that never became a message (its append failed) is deleted outright", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "sentPhotos");
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const { id, fileId } = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["x"]));
      const id = await ctx.db.insert("messageAttachments", {
        kind: "image",
        threadAggregateId: world.threadId,
        uploaderId: world.alice,
        fileId,
        byteSize: 1,
        contentType: "image/jpeg",
        moderationStatus: "unscored",
        hashCheckedAt: 1,
        reencodedAt: 1,
        sendRequestedAt: Date.now(),
        sendIndex: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      return { id, fileId };
    });

    await sweep(t);

    expect(await rowOf(t, id)).toBeNull();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("pages past the page size", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "sentPhotos");
    const t = convexTest(schema, modules);
    const world = await openThread(t);
    const ids = await t.run(async (ctx) => {
      const ids: Id<"messageAttachments">[] = [];
      for (let i = 0; i < RETENTION_SWEEP_PAGE + 3; i++) {
        ids.push(
          await ctx.db.insert("messageAttachments", {
            kind: "image",
            threadAggregateId: world.threadId,
            uploaderId: world.alice,
            fileId: await ctx.storage.store(new Blob(["x"])),
            byteSize: 1,
            contentType: "image/jpeg",
            moderationStatus: "unscored",
            hashCheckedAt: 1,
            reencodedAt: 1,
            sendRequestedAt: Date.now(),
            sendIndex: 0,
            messageId: `m-${i}`,
            createdAt: 1,
            updatedAt: 1,
          }),
        );
      }
      return ids;
    });

    await sweep(t);

    const rows = await t.run((ctx) =>
      Promise.all(ids.map((id) => ctx.db.get(id))),
    );
    expect(
      rows.every(
        (row) => row?.kind === "image" && row.removedReason === "expired",
      ),
    ).toBe(true);
    expect(
      sweepEvents("sentPhotos")
        .filter((e) => e.phase === "unscored")
        .map((e) => e.acted),
    ).toEqual([RETENTION_SWEEP_PAGE, 3]);
  });
});

describe("copy photos the automated check rejected, 30 days on", () => {
  const seedCopy = (t: T) =>
    t.run(async (ctx) => {
      const mkUser = (clerkId: string) =>
        ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.com`,
          name: clerkId,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
        });
      const alice = await mkUser("clerk_alice");
      const bob = await mkUser("clerk_bob");
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        createdAt: 1,
        updatedAt: 1,
      });
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      });
      return { alice, bob, copyId };
    });

  // A copy photo rejected `rejectedAt` (default: now), by the check unless `moderatedBy` is set.
  const seedPhoto = (
    t: T,
    world: { alice: Id<"users">; copyId: Id<"ownedPuzzles"> },
    opts: {
      status?: "rejected" | "approved";
      rejectedAt?: number;
      moderatedBy?: Id<"users">;
      hashCleared?: boolean;
    } = {},
  ) =>
    t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
      const imageId = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: world.copyId,
        uploaderId: world.alice,
        fileId,
        moderationStatus: opts.status ?? "rejected",
        moderationScore: 0.97,
        moderationLabel: "nsfw",
        ...(opts.moderatedBy && { moderatedBy: opts.moderatedBy }),
        ...(opts.hashCleared === false
          ? { hashCheckPendingSince: 1 }
          : { hashCheckedAt: 1 }),
        createdAt: 1,
        updatedAt: opts.rejectedAt ?? Date.now(),
      });
      return { imageId, fileId };
    });

  const thirtyOneDaysLater = () =>
    Date.now() + REJECTED_COPY_PHOTO_TTL_MS + DAY_MS;
  const sweep = async (t: T, now = thirtyOneDaysLater()) => {
    await t.mutation(internal.library.moderationStore.sweepRejectedCopyPhotos, {
      now,
    });
    await flush(t);
  };

  test("dry run: counted, nothing changes", async () => {
    const t = convexTest(schema, modules);
    const world = await seedCopy(t);
    const { imageId, fileId } = await seedPhoto(t, world);

    await sweep(t);

    expect(await t.run((ctx) => ctx.db.get(imageId))).not.toBeNull();
    expect(await blobExists(t, fileId)).toBe(true);
    expect(
      sweepEvents("copyPhotos").map((e) => [e.due, e.acted, e.dry_run]),
    ).toEqual([[1, 0, true]]);
  });

  test("enforced: the row and its blob go, and the copy loses it as its cover", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "copyPhotos");
    const t = convexTest(schema, modules);
    const world = await seedCopy(t);
    const { imageId, fileId } = await seedPhoto(t, world);
    await t.run((ctx) => ctx.db.patch(world.copyId, { coverImageId: imageId }));

    await sweep(t);

    expect(await t.run((ctx) => ctx.db.get(imageId))).toBeNull();
    expect(await blobExists(t, fileId)).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(world.copyId))).not.toHaveProperty(
      "coverImageId",
    );
    expect(sweepEvents("copyPhotos")).toEqual([
      expect.objectContaining({ due: 1, acted: 1, dry_run: false }),
    ]);
  });

  test("kept: inside 30 days, a person's rejection, an approved photo, an open report, hash check not done", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "copyPhotos");
    const t = convexTest(schema, modules);
    const world = await seedCopy(t);
    const now = thirtyOneDaysLater();
    const kept = [
      await seedPhoto(t, world, { rejectedAt: now - DAY_MS }),
      await seedPhoto(t, world, { moderatedBy: world.bob }),
      await seedPhoto(t, world, { status: "approved" }),
      await seedPhoto(t, world, { hashCleared: false }),
    ];
    const reported = await seedPhoto(t, world);
    await t.run((ctx) =>
      ctx.db.insert("reports", {
        reporterId: world.bob,
        targetKind: "photo",
        targetId: reported.imageId,
        reportedUserId: world.alice,
        reason: "sexual",
        evidence: {},
        status: "open",
        createdAt: 1,
      }),
    );

    await sweep(t, now);

    for (const { imageId, fileId } of [...kept, reported]) {
      expect(await t.run((ctx) => ctx.db.get(imageId))).not.toBeNull();
      expect(await blobExists(t, fileId)).toBe(true);
    }
    expect(sweepEvents("copyPhotos")).toEqual([
      expect.objectContaining({
        due: 0,
        acted: 0,
        held_report: 1,
        held_hash_check: 1,
      }),
    ]);
  });

  test("pages past the page size", async () => {
    vi.stubEnv("RETENTION_ENFORCE", "copyPhotos");
    const t = convexTest(schema, modules);
    const world = await seedCopy(t);
    for (let i = 0; i < RETENTION_SWEEP_PAGE + 2; i++) {
      await seedPhoto(t, world);
    }

    await sweep(t);

    expect(
      await t.run((ctx) => ctx.db.query("ownedPuzzleImages").collect()),
    ).toEqual([]);
    expect(sweepEvents("copyPhotos").map((e) => e.acted)).toEqual([
      RETENTION_SWEEP_PAGE,
      2,
    ]);
  });
});
