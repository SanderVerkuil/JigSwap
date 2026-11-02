import type { ProjectedMember } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// SEC-11 (SOC-3, SURF-2): catalog reviews, copy comments and photo comments name their author
// through the privacy chokepoint (projectMemberIdentity), like every other member on a copy page.
// A private author is "Anonymous user" to a member they are not connected with, is named identity
// only (no bio, location or language) to a circle mate, and no response ever carries a private
// author's profile details. Reviews of a definition that is not approved are listed only for its
// submitter and admins, as getPuzzleById discloses the definition itself.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A review list is paged; these tests look at what one generous page says.
const FIRST_PAGE = { numItems: 50, cursor: null };

type T = TestConvex<typeof schema>;

// Every profile detail of the private author, and her account name: none of them may reach a
// stranger, and the details may reach nobody but herself.
const ACCOUNT_NAME = "Real Fullname";
const PROFILE_DETAILS = ["secret bio", "Secret Town", '"nl"'];

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (key: string, extra: Record<string, string> = {}) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${key}`,
        email: `${key}@example.com`,
        name: key,
        username: key,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const priv = await mkUser("priv", {
      name: ACCOUNT_NAME,
      avatar: "https://img.example.com/priv.png",
      bio: "secret bio",
      location: "Secret Town",
      preferredLanguage: "nl",
    });
    await ctx.db.insert("profiles", {
      memberId: priv,
      displayName: "Pseudonym",
      visibility: "private",
      updatedAt: now,
    });
    const stranger = await mkUser("stranger");
    const mate = await mkUser("mate");
    const owner = await mkUser("owner");
    const submitter = await mkUser("submitter");
    // The mate and the private author share a circle: identity only.
    for (const memberId of [priv, mate]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-1",
        memberId,
      });
    }

    const mkPuzzle = (status: "approved" | "pending") =>
      ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: `Puzzle ${status}`,
        pieceCount: 1000,
        status,
        submittedBy: submitter,
        createdAt: now,
        updatedAt: now,
      });
    const approved = await mkPuzzle("approved");
    const pending = await mkPuzzle("pending");
    for (const puzzleId of [approved, pending]) {
      await ctx.db.insert("puzzleReviews", {
        userId: priv,
        puzzleId,
        rating: 4,
        text: "Lovely sky",
        createdAt: now,
        updatedAt: now,
      });
    }

    // A public owner's open copy (any member may view it), with the private author's comment on
    // the copy and on one of its photos.
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId: approved,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("puzzleComments", {
      aggregateId: crypto.randomUUID(),
      puzzleId: approved,
      copyId: copy,
      authorId: priv,
      text: "Nice copy",
      createdAt: now,
    });
    const photo = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: owner,
      fileId: await ctx.storage.store(new Blob(["img"], { type: "image/png" })),
      title: "Box front",
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("photoComments", {
      aggregateId: crypto.randomUUID(),
      photoId: photo,
      authorId: priv,
      text: "Great photo",
      createdAt: now,
    });
    return { priv, stranger, mate, submitter, approved, pending, copy, photo };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const as = (t: T, key: string) => t.withIdentity({ subject: `clerk_${key}` });

// The author of every list the viewer can read: the approved definition's reviews, the copy's
// comments and the photo's comments.
const authorsSeenBy = async (t: T, key: string, u: Seeded) => {
  const viewer = as(t, key);
  const [reviews, comments, photoComments] = await Promise.all([
    viewer
      .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
        puzzleId: u.approved,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page),
    viewer.query(api.social.listPuzzleComments.listPuzzleComments, {
      copyId: u.copy,
    }),
    viewer.query(api.library.listPhotoComments.listPhotoComments, {
      photoId: u.photo,
    }),
  ]);
  for (const list of [reviews, comments, photoComments]) {
    expect(list).toHaveLength(1);
  }
  return {
    responses: [reviews, comments, photoComments],
    authors: [reviews[0].author, comments[0].author, photoComments[0].author],
  };
};

const expectNoProfileDetails = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const leak of PROFILE_DETAILS) expect(json).not.toContain(leak);
};

describe("SEC-11: review and comment authors are privacy-projected", () => {
  test("a private author is anonymous to a stranger: no id, name, avatar or details", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const { responses, authors } = await authorsSeenBy(t, "stranger", u);
    for (const author of authors) {
      expect(author).toEqual({ anonymous: true, anonRef: expect.any(String) });
    }
    const json = JSON.stringify(responses);
    for (const leak of [u.priv as string, ACCOUNT_NAME, "Pseudonym", "priv"]) {
      expect(json).not.toContain(leak);
    }
    expectNoProfileDetails(responses);
  });

  test("the comments on one copy share the copy page's anonymous reference", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const { authors } = await authorsSeenBy(t, "stranger", u);
    const [, comment, photoComment] = authors as Extract<
      ProjectedMember,
      { anonymous: true }
    >[];
    // Salted with the copy id, as getCopyInstanceView is: one hidden member, one reference.
    expect(photoComment.anonRef).toBe(comment.anonRef);
  });

  test("a circle mate sees the private author's name and avatar, identity only", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const { responses, authors } = await authorsSeenBy(t, "mate", u);
    for (const author of authors) {
      expect(author).toMatchObject({
        anonymous: false,
        member: {
          _id: u.priv,
          name: ACCOUNT_NAME,
          avatar: "https://img.example.com/priv.png",
        },
      });
    }
    expectNoProfileDetails(responses);
  });

  test("a mutual follower sees the author as before", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run(async (ctx) => {
      for (const [followerId, followeeId] of [
        [u.stranger, u.priv],
        [u.priv, u.stranger],
      ]) {
        await ctx.db.insert("follows", {
          followerId,
          followeeId,
          createdAt: Date.now(),
        });
      }
    });
    const { authors } = await authorsSeenBy(t, "stranger", u);
    for (const author of authors) {
      expect(author).toMatchObject({
        anonymous: false,
        member: { _id: u.priv, name: ACCOUNT_NAME },
      });
    }
  });

  test("the author sees their own review and comments", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const { authors } = await authorsSeenBy(t, "priv", u);
    for (const author of authors) {
      expect(author).toMatchObject({
        anonymous: false,
        member: { _id: u.priv },
      });
    }
  });
});

describe("SEC-11: reviews of a definition that is not approved", () => {
  test("are not listed for another member", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    expect(
      await as(t, "stranger")
        .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
          puzzleId: u.pending,
          paginationOpts: FIRST_PAGE,
        })
        .then((result) => result.page),
    ).toEqual([]);
  });

  test("are listed for the submitter", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const reviews = await as(t, "submitter")
      .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
        puzzleId: u.pending,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page);
    expect(reviews).toHaveLength(1);
  });

  test("are listed for an admin", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const reviews = await t
      .withIdentity({ subject: "clerk_stranger", metadata: { role: "admin" } })
      .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
        puzzleId: u.pending,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page);
    expect(reviews).toHaveLength(1);
  });
});

// SEC-11 (SOC-3, LIB-9): the people behind a follow request and a loan are shown identity only:
// name, handle and avatar, never bio, location or language. A follow request shows what the
// requester's own link (/members/$handle) would show; a loan party stays named (it is the
// member's own loan of a physical copy), also across a block, but never with profile details.
describe("SEC-11: follow requests and loans are identity only", () => {
  test("an incoming follow request from a private member carries no profile details", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: crypto.randomUUID(),
        requesterId: u.priv,
        targetId: u.stranger,
        status: "pending",
        createdAt: Date.now(),
      }),
    );
    const requests = await as(t, "stranger").query(
      api.social.listIncomingFollowRequests.listIncomingFollowRequests,
      {},
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].requester).toEqual({
      memberId: u.priv,
      displayName: "Pseudonym",
      username: "priv",
      avatar: "https://img.example.com/priv.png",
    });
    expectNoProfileDetails(requests);
  });

  test("the lender never sees the borrower's profile details, also after a block", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    const copyAggregateId = crypto.randomUUID();
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("ownedPuzzles", {
        aggregateId: copyAggregateId,
        puzzleId: u.approved,
        ownerId: u.stranger,
        condition: "good",
        heldBy: u.priv,
        availability: { forTrade: false, forSale: false, forLend: true },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("loans", {
        aggregateId: crypto.randomUUID(),
        copyId: copyAggregateId,
        lenderId: u.stranger,
        borrowerId: u.priv,
        status: "open",
        openedAt: now,
      });
      // The borrower blocks the lender.
      await ctx.db.insert("blocks", {
        blockerId: u.priv,
        blockedId: u.stranger,
        createdAt: now,
      });
    });
    const lent = await as(t, "stranger").query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    expect(lent).toHaveLength(1);
    expect(lent[0].borrower).toMatchObject({ _id: u.priv, username: "priv" });
    expectNoProfileDetails(lent);

    // The borrower's own list names the lender identity only as well.
    await t.run((ctx) =>
      ctx.db.patch(u.stranger, {
        bio: "lender bio",
        location: "Lender Town",
        preferredLanguage: "de",
      }),
    );
    const borrowed = await as(t, "priv").query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    expect(borrowed).toHaveLength(1);
    expect(borrowed[0].lender).toMatchObject({ _id: u.stranger });
    const json = JSON.stringify(borrowed);
    for (const leak of ["lender bio", "Lender Town", '"de"']) {
      expect(json).not.toContain(leak);
    }
  });
});
