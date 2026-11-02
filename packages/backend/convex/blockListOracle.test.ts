import type { ProjectedMember } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-40: lists that drop blocked authors (spec 2.6) must not turn a block into an oracle. A
// private author the viewer can't see is an anonymous entry (SEC-11); if blocking a candidate made
// that entry vanish, the viewer would learn who wrote it. So a block BY the viewer drops an
// author's entries only when the viewer could already see who the author is (public profile,
// mutual follow, shared circle). A hidden author keeps their entry with the same anonymous
// reference and no flag. A block by the AUTHOR still drops their entries, since the viewer can't
// trigger that. Covers puzzle reviews, copy comments, photo comments, received partner reviews and
// the public catalog reviews.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A review list is paged; these tests look at what one generous page says.
const FIRST_PAGE = { numItems: 50, cursor: null };

type T = TestConvex<typeof schema>;
type Who = "viewer" | "priv" | "pub" | "mate" | "owner";

// priv (private, unconnected to the viewer) and pub (public) each leave one entry on every list.
// owner is public and owns the open copy everything hangs off; mate shares a circle with priv.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (key: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${key}`,
        email: `${key}@example.com`,
        name: `${key} name`,
        username: key,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const u = {
      viewer: await mkUser("viewer"),
      priv: await mkUser("priv"),
      pub: await mkUser("pub"),
      mate: await mkUser("mate"),
      owner: await mkUser("owner"),
    };
    for (const [memberId, visibility] of [
      [u.viewer, "public"],
      [u.priv, "private"],
      [u.pub, "public"],
      [u.mate, "public"],
      [u.owner, "public"],
    ] as const) {
      await ctx.db.insert("profiles", { memberId, visibility, updatedAt: now });
    }
    for (const memberId of [u.priv, u.mate]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-1",
        memberId,
      });
    }

    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: u.owner,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: u.owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: u.owner,
      fileId: await ctx.storage.store(new Blob(["img"], { type: "image/png" })),
      createdAt: now,
      updatedAt: now,
    });
    for (const authorId of [u.priv, u.pub]) {
      await ctx.db.insert("puzzleReviews", {
        userId: authorId,
        puzzleId,
        rating: 4,
        text: "Lovely sky",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("puzzleComments", {
        aggregateId: crypto.randomUUID(),
        puzzleId,
        copyId,
        authorId,
        text: "Nice copy",
        createdAt: now,
      });
      await ctx.db.insert("photoComments", {
        aggregateId: crypto.randomUUID(),
        photoId,
        authorId,
        text: "Great photo",
        createdAt: now,
      });
      // Each author traded with the public owner and reviewed them.
      const exchangeId = await ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId: authorId,
        recipientId: u.owner,
        type: "trade",
        requestedPuzzleId: copyId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("reviews", {
        aggregateId: crypto.randomUUID(),
        exchangeId,
        reviewerId: authorId,
        revieweeId: u.owner,
        rating: 4,
        comment: "Smooth trade",
        categories: {
          communication: 5,
          packaging: 4,
          condition: 5,
          timeliness: 4,
        },
        createdAt: now,
      });
    }
    return { u, puzzleId, copyId, photoId };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

// Every list, as `who` reads it.
const listsSeenBy = async (t: T, who: Who, s: Seeded) => {
  const viewer = as(t, who);
  return {
    puzzleReviews: await viewer
      .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
        puzzleId: s.puzzleId,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page),
    copyComments: await viewer.query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: s.copyId },
    ),
    photoComments: await viewer.query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId: s.photoId },
    ),
    receivedReviews: (
      await viewer.query(
        api.reputation.listReviewsForMember.listReviewsForMember,
        { memberId: s.u.owner },
      )
    ).map(({ reviewer, ...rest }) => ({ ...rest, author: reviewer })),
    publicReviews: await viewer
      .query(api.social.listPublicPuzzleReviews.listPublicPuzzleReviewsPage, {
        puzzleId: s.puzzleId,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page),
  };
};

// The ids of the revealed authors on every member-facing list, and how many anonymous entries.
const summary = (
  lists: Awaited<ReturnType<typeof listsSeenBy>>,
): Record<string, string[]> => {
  const { publicReviews, ...rest } = lists;
  const memberLists: Record<string, readonly { author: ProjectedMember }[]> =
    rest;
  const authors: Record<string, string[]> = {};
  for (const [name, rows] of Object.entries(memberLists)) {
    authors[name] = rows
      .map((row) =>
        row.author.anonymous ? "anonymous" : (row.author.member._id as string),
      )
      .sort();
  }
  authors.publicReviews = publicReviews
    .map((row) => row.author?.name ?? "anonymous")
    .sort();
  return authors;
};

describe("SEC-40: a block by the viewer never singles out an anonymous author", () => {
  test("blocking a private author the viewer can't see leaves every list exactly as it was", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const before = await listsSeenBy(t, "viewer", s);
    expect(summary(before)).toEqual({
      puzzleReviews: [s.u.pub, "anonymous"].sort(),
      copyComments: [s.u.pub, "anonymous"].sort(),
      photoComments: [s.u.pub, "anonymous"].sort(),
      receivedReviews: [s.u.pub, "anonymous"].sort(),
      publicReviews: ["anonymous", "pub name"].sort(),
    });

    await block(t, s.u.viewer, s.u.priv);
    const after = await listsSeenBy(t, "viewer", s);
    // Same entries, same anonymous references, no flag: nothing tells the block apart.
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(s.u.priv);
  });

  test("blocking a member the viewer can see drops their entries", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await block(t, s.u.viewer, s.u.pub);
    expect(summary(await listsSeenBy(t, "viewer", s))).toEqual({
      puzzleReviews: ["anonymous"],
      copyComments: ["anonymous"],
      photoComments: ["anonymous"],
      receivedReviews: ["anonymous"],
      publicReviews: ["anonymous"],
    });
  });

  test("a circle mate who blocks the private author no longer sees their entries", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    expect(summary(await listsSeenBy(t, "mate", s))).toEqual({
      puzzleReviews: [s.u.priv, s.u.pub].sort(),
      copyComments: [s.u.priv, s.u.pub].sort(),
      photoComments: [s.u.priv, s.u.pub].sort(),
      receivedReviews: [s.u.priv, s.u.pub].sort(),
      publicReviews: ["anonymous", "pub name"].sort(),
    });

    // The mate sees who priv is, so the block takes effect everywhere, the public page included
    // (it names priv to nobody, but the mate knows the entry is theirs).
    await block(t, s.u.mate, s.u.priv);
    expect(summary(await listsSeenBy(t, "mate", s))).toEqual({
      puzzleReviews: [s.u.pub],
      copyComments: [s.u.pub],
      photoComments: [s.u.pub],
      receivedReviews: [s.u.pub],
      publicReviews: ["pub name"],
    });
  });

  test("a block by the author drops their entries, hidden or not", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await block(t, s.u.priv, s.u.viewer);
    await block(t, s.u.pub, s.u.viewer);
    expect(summary(await listsSeenBy(t, "viewer", s))).toEqual({
      puzzleReviews: [],
      copyComments: [],
      photoComments: [],
      receivedReviews: [],
      publicReviews: [],
    });
  });

  test("a mutual block drops a hidden author's entries as the author's block alone did", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await block(t, s.u.priv, s.u.viewer);
    const theirBlockOnly = summary(await listsSeenBy(t, "viewer", s));
    expect(theirBlockOnly.puzzleReviews).toEqual([s.u.pub]);
    await block(t, s.u.viewer, s.u.priv);
    expect(summary(await listsSeenBy(t, "viewer", s))).toEqual(theirBlockOnly);
  });
});
