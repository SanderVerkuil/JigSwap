import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;
const TITLE = "Mountain Vista";
const RETITLE = "Unmoderated retitle";

// Seed: alice (the actor) and bob (her one-way follower); one approved definition with box art.
const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const boxArt = await ctx.storage.store(new Blob(["box art"]));
    const definitionId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: TITLE,
      pieceCount: 1000,
      searchableText: TITLE,
      status: "approved",
      submittedBy: bob,
      image: boxArt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    const boxArtUrl = await ctx.storage.getUrl(boxArt);
    return { alice, bob, definitionId, boxArtUrl };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const feedOf = (t: TestConvex<typeof schema>, viewer: string) =>
  asUser(t, viewer).query(api.social.getActivityFeed.getActivityFeed, {});

const entryOf = async (
  t: TestConvex<typeof schema>,
  viewer: string,
  kind: string,
) => (await feedOf(t, viewer)).find((e) => e.kind === kind);

// One acquireCopy call; `open` lists it for trade so a non-owner may view it (canViewCopy).
const addCopy = async (
  t: TestConvex<typeof schema>,
  definitionId: string,
  open: boolean,
) => {
  const copyId = await asUser(t, "alice").mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: definitionId, condition: "good" },
  );
  if (open) {
    await asUser(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible", forTrade: true },
    );
  }
  return copyId;
};

// Gives the copy an approved (legacy: no moderation fields) cover photo; returns that photo's URL.
const setCoverPhoto = (
  t: TestConvex<typeof schema>,
  copyAggregateId: string,
  uploader: Id<"users">,
) =>
  t.run(async (ctx) => {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyAggregateId))
      .unique();
    const fileId = await ctx.storage.store(new Blob(["cover photo"]));
    const now = Date.now();
    const imageId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy!._id,
      uploaderId: uploader,
      fileId,
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(copy!._id, { coverImageId: imageId });
    return ctx.storage.getUrl(fileId);
  });

const recordSolve = (t: TestConvex<typeof schema>, copyId: string) =>
  asUser(t, "alice").mutation(api.solving.recordCompletion.recordCompletion, {
    copyId,
    startDate: Date.now() - 2 * HOUR,
    endDate: Date.now() - HOUR,
  });

const follow = (
  t: TestConvex<typeof schema>,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: Date.now(),
    });
  });

const setVisibility = (
  t: TestConvex<typeof schema>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      visibility,
      updatedAt: Date.now(),
    });
  });

describe("social.getActivityFeed — the puzzle an entry is about", () => {
  test("names the viewer's own single add, with the puzzle's box art", async () => {
    const t = convexTest(schema, modules);
    const { definitionId, boxArtUrl } = await seed(t);
    await addCopy(t, definitionId, false);

    expect((await entryOf(t, "alice", "acquisition"))?.subject).toEqual({
      title: TITLE,
      coverUrl: boxArtUrl,
    });
  });

  test("names a followee's add of a copy the follower may view, with its cover photo", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, true);
    const photoUrl = await setCoverPhoto(t, copyId, alice);

    expect((await entryOf(t, "bob", "acquisition"))?.subject).toEqual({
      title: TITLE,
      coverUrl: photoUrl,
    });
  });

  test("never names a copy hidden from the follower", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await addCopy(t, definitionId, false);

    const feed = await feedOf(t, "bob");
    expect(feed.find((e) => e.kind === "acquisition")).toBeUndefined();
    expect(JSON.stringify(feed)).not.toContain(TITLE);
  });

  test("a solve on a copy the follower can't reach shows the box art, never the copy's photo", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId, boxArtUrl } = await seed(t);
    const copyId = await addCopy(t, definitionId, false);
    const photoUrl = await setCoverPhoto(t, copyId, alice);
    await recordSolve(t, copyId);

    expect((await entryOf(t, "alice", "completion"))?.subject).toEqual({
      title: TITLE,
      coverUrl: photoUrl,
    });
    expect((await entryOf(t, "bob", "completion"))?.subject).toEqual({
      title: TITLE,
      coverUrl: boxArtUrl,
    });
  });

  test("a private actor's solve is hidden from a one-way follower (SEC-43), and named once mutual", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, definitionId } = await seed(t);
    await setVisibility(t, alice, "private");
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);

    const feed = await feedOf(t, "bob");
    expect(feed.find((e) => e.kind === "completion")).toBeUndefined();
    expect(JSON.stringify(feed)).not.toContain(TITLE);

    await follow(t, alice, bob);
    expect((await entryOf(t, "bob", "completion"))?.subject?.title).toBe(TITLE);
  });

  test("a solve is named from the snapshot taken when it was logged", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, true);
    await recordSolve(t, copyId);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("completions").first();
      await ctx.db.patch(row!._id, {
        copySnapshot: { ...row!.copySnapshot!, title: "Vista, 2019 edition" },
      });
    });

    expect((await entryOf(t, "bob", "completion"))?.subject?.title).toBe(
      "Vista, 2019 edition",
    );
  });

  test("a followee's add of a non-approved definition names the copy's snapshot, not its live title", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await addCopy(t, definitionId, true);
    await t.run(async (ctx) => {
      const puzzle = await ctx.db.query("puzzles").first();
      await ctx.db.patch(puzzle!._id, { status: "pending", title: RETITLE });
    });

    const feed = await feedOf(t, "bob");
    expect(feed.find((e) => e.kind === "acquisition")?.subject?.title).toBe(
      TITLE,
    );
    expect(JSON.stringify(feed)).not.toContain(RETITLE);
  });

  test("a solve without a snapshot quotes a non-approved definition only to who may open it", async () => {
    const t = convexTest(schema, modules);
    const { alice, definitionId } = await seed(t);
    const copyId = await addCopy(t, definitionId, false);
    await recordSolve(t, copyId);
    await t.run(async (ctx) => {
      const puzzle = await ctx.db.query("puzzles").first();
      await ctx.db.patch(puzzle!._id, {
        status: "pending",
        title: RETITLE,
        submittedBy: alice,
      });
      const row = await ctx.db.query("completions").first();
      await ctx.db.patch(row!._id, { copySnapshot: undefined });
    });

    const feed = await feedOf(t, "bob");
    expect(feed.find((e) => e.kind === "completion")).toBeDefined();
    expect(feed.find((e) => e.kind === "completion")?.subject).toBeUndefined();
    expect(JSON.stringify(feed)).not.toContain(RETITLE);
    expect((await entryOf(t, "alice", "completion"))?.subject?.title).toBe(
      RETITLE,
    );
  });

  test("a batch carries no subject: it names its puzzles in its own covers", async () => {
    const t = convexTest(schema, modules);
    const { definitionId } = await seed(t);
    await asUser(t, "alice").mutation(api.library.acquireCopies.acquireCopies, {
      items: [{ puzzleDefinitionId: definitionId, forTrade: true }],
    });

    const entry = await entryOf(t, "bob", "acquisitionBatch");
    expect(entry?.batch?.covers[0]?.title).toBe(TITLE);
    expect(entry?.subject).toBeUndefined();
  });
});
