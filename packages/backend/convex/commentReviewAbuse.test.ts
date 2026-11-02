import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-28 (review repros LIB-6 and SOC-13): photo comments, copy comments and puzzle reviews took
// text of any length, so a harasser could post 50 KB comments under a member's photo and a
// spammer near-1 MB reviews that every catalogue visitor loads.

type T = TestConvex<typeof schema>;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

// Alice (public profile, the default) owns an OPEN copy of an approved puzzle, with one legacy
// photo (no moderation status = approved), so any member may see and discuss it (canViewCopy).
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["fake-image-bytes"], { type: "image/png" }),
    );
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: alice,
      fileId,
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, copyId, photoId };
  });

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const e = await p.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(ConvexError);
  const data = (e as ConvexError<Value>).data;
  return typeof data === "object" && data !== null && "code" in data
    ? String(data.code)
    : undefined;
};

const countRows = (
  t: T,
  table: "photoComments" | "puzzleComments" | "puzzleReviews",
) => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("comment and review text caps (SEC-28)", () => {
  test("a 50 KB photo comment is refused; 1000 characters is accepted", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
          photoId,
          text: "A".repeat(50_000),
        }),
      ),
    ).toBe("CommentTextTooLong");
    expect(await countRows(t, "photoComments")).toBe(0);

    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "A".repeat(1000),
    });
    expect(await countRows(t, "photoComments")).toBe(1);
  });

  test("a copy comment over 1000 characters is refused", async () => {
    const t = convexTest(schema, modules);
    const { copyId } = await seed(t);

    expect(
      await codeOf(
        asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
          copyId,
          text: "A".repeat(1001),
        }),
      ),
    ).toBe("CommentTextTooLong");
    expect(await countRows(t, "puzzleComments")).toBe(0);
  });

  test("a 360 KB review is refused by postPuzzleReview; 2000 characters is accepted", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
          puzzleId,
          rating: 1,
          text: "BUY CHEAP PUZZLES ".repeat(20_000),
        }),
      ),
    ).toBe("ReviewTextTooLong");
    expect(await countRows(t, "puzzleReviews")).toBe(0);

    await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
      text: "A".repeat(2000),
    });
    expect(await countRows(t, "puzzleReviews")).toBe(1);
  });

  test("a stored review past the cap can have its rating changed; editing the text must shorten it", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleId } = await seed(t);
    const legacy = "A".repeat(2500);
    const row = await t.run((ctx) =>
      ctx.db.insert("puzzleReviews", {
        userId: bob,
        puzzleId,
        rating: 5,
        text: legacy,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const save = (rating: number, text: string) =>
      asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        rating,
        text,
      });

    await save(2, legacy);
    expect(await t.run((ctx) => ctx.db.get(row))).toMatchObject({
      rating: 2,
      text: legacy,
    });

    expect(await codeOf(save(2, `${legacy} and more`))).toBe(
      "ReviewTextTooLong",
    );

    await save(3, "Shorter now");
    expect((await t.run((ctx) => ctx.db.get(row)))?.text).toBe("Shorter now");
  });

  test("submitReviews refuses puzzle review text over 2000 characters", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId } = await seed(t);

    expect(
      await codeOf(
        asBob(t).mutation(api.solving.submitReviews.submitReviews, {
          puzzleId,
          puzzle: { rating: 1, text: "A".repeat(2001) },
        }),
      ),
    ).toBe("ReviewTextTooLong");
    expect(await countRows(t, "puzzleReviews")).toBe(0);
  });
});

describe("photo discussion only on published photos, newest 100 shown (SEC-28)", () => {
  const setPhoto = (
    t: T,
    photoId: Id<"ownedPuzzleImages">,
    patch: {
      moderationStatus?: "pending" | "rejected" | "unscored" | "quarantined";
      hashCheckPendingSince?: number;
    },
  ) => t.run((ctx) => ctx.db.patch(photoId, patch));

  const seedComments = (
    t: T,
    photoId: Id<"ownedPuzzleImages">,
    authorId: Id<"users">,
    count: number,
  ) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("photoComments", {
          photoId,
          authorId,
          text: `comment ${i}`,
          createdAt: i,
        });
      }
    });

  const list = (t: T, photoId: Id<"ownedPuzzleImages">) =>
    asBob(t).query(api.library.listPhotoComments.listPhotoComments, {
      photoId,
    });

  test.each(["pending", "unscored", "rejected", "quarantined"] as const)(
    "nobody may comment on a %s photo, the uploader included",
    async (moderationStatus) => {
      const t = convexTest(schema, modules);
      const { photoId } = await seed(t);
      await setPhoto(t, photoId, { moderationStatus });

      for (const as of [asAlice, asBob]) {
        await expect(
          as(t).mutation(api.library.postPhotoComment.postPhotoComment, {
            photoId,
            text: "hello",
          }),
        ).rejects.toThrow("Photo not found");
      }
      expect(await countRows(t, "photoComments")).toBe(0);
    },
  );

  test("a photo whose hash check has not passed takes no comments", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);
    await setPhoto(t, photoId, { hashCheckPendingSince: Date.now() });

    await expect(
      asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
        photoId,
        text: "hello",
      }),
    ).rejects.toThrow("Photo not found");
  });

  test("an unpublished photo's earlier comments are not listed", async () => {
    const t = convexTest(schema, modules);
    const { alice, photoId } = await seed(t);
    await seedComments(t, photoId, alice, 2);
    expect(await list(t, photoId)).toHaveLength(2);

    await setPhoto(t, photoId, { moderationStatus: "rejected" });
    expect(await list(t, photoId)).toEqual([]);
  });

  test("the list returns only the newest 100 comments", async () => {
    const t = convexTest(schema, modules);
    const { alice, photoId } = await seed(t);
    await seedComments(t, photoId, alice, 120);

    const comments = await list(t, photoId);
    expect(comments).toHaveLength(100);
    expect(comments[0].text).toBe("comment 119");
    expect(comments[99].text).toBe("comment 20");
  });
});

describe("reviews only on approved definitions or your own submission (SEC-28)", () => {
  const seedPending = (t: T, submittedBy: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: "Pending Vista",
        pieceCount: 500,
        status: "pending",
        submittedBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

  test("a spammer cannot review someone else's pending definition", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const pending = await seedPending(t, alice);

    expect(
      await codeOf(
        asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
          puzzleId: pending,
          rating: 1,
          text: "on a pending definition",
        }),
      ),
    ).toBe("PuzzleNotReviewable");
    expect(
      await codeOf(
        asBob(t).mutation(api.solving.submitReviews.submitReviews, {
          puzzleId: pending,
          puzzle: { rating: 1 },
        }),
      ),
    ).toBe("PuzzleNotReviewable");
    expect(await countRows(t, "puzzleReviews")).toBe(0);
  });

  test.each(["rejected", "disabled"] as const)(
    "a %s definition takes no reviews from other members",
    async (status) => {
      const t = convexTest(schema, modules);
      const { puzzleId } = await seed(t);
      await t.run((ctx) => ctx.db.patch(puzzleId, { status }));

      expect(
        await codeOf(
          asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
            puzzleId,
            rating: 3,
          }),
        ),
      ).toBe("PuzzleNotReviewable");
    },
  );

  test("the submitter may review their own pending definition through either form", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const pending = await seedPending(t, alice);

    await asAlice(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId: pending,
      rating: 4,
    });
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId: pending,
      puzzle: { rating: 5, text: "my own submission" },
    });
    const rows = await t.run((ctx) => ctx.db.query("puzzleReviews").collect());
    expect(rows.map((r) => [r.rating, r.text])).toEqual([
      [5, "my own submission"],
    ]);
  });

  test("getMyReviews tells the form whether the puzzle level can be saved", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId } = await seed(t);
    const pending = await seedPending(t, alice);
    const allowed = async (as: typeof asAlice, id: Id<"puzzles">) =>
      (
        await as(t).query(api.solving.getMyReviews.getMyReviews, {
          puzzleId: id,
        })
      ).puzzleReviewAllowed;

    expect(await allowed(asBob, puzzleId)).toBe(true);
    expect(await allowed(asBob, pending)).toBe(false);
    expect(await allowed(asAlice, pending)).toBe(true);

    await t.run((ctx) => ctx.db.delete(pending));
    expect(await allowed(asAlice, pending)).toBe(false);
  });

  test("a copy-only review still works on a definition the member cannot review", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, copyId, puzzleId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(puzzleId, { status: "disabled", submittedBy: bob }),
    );
    // Alice may not review the puzzle, but she owns the copy, so she may rate it; the puzzle
    // level is not sent.
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId,
      copy: { rating: 4 },
    });
    const rows = await t.run((ctx) => ctx.db.query("copyReviews").collect());
    expect(rows.map((r) => [r.userId, r.rating])).toEqual([[alice, 4]]);
  });
});

describe("comment and review rate limits (SEC-28)", () => {
  // Move every window of `name` back by its length, as if it had run out.
  const expireWindow = (t: T, name: "commentPost" | "reviewPost") =>
    t.run(async (ctx) => {
      for (const row of await ctx.db.query("rateLimits").collect()) {
        if (row.key.startsWith(`${name}:`)) {
          await ctx.db.patch(row._id, {
            windowStart: row.windowStart - RATE_LIMITS[name].windowMs,
          });
        }
      }
    });

  test("the 31st comment in an hour is refused, photo and copy comments together", async () => {
    const t = convexTest(schema, modules);
    const { copyId, photoId } = await seed(t);
    expect(RATE_LIMITS.commentPost).toEqual({ windowMs: 3_600_000, max: 30 });

    for (let i = 0; i < 29; i++) {
      await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
        photoId,
        text: `comment ${i}`,
      });
    }
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId,
      text: "note 30",
    });
    expect(
      await codeOf(
        asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
          photoId,
          text: "comment 31",
        }),
      ),
    ).toBe("RateLimited");
    expect(
      await codeOf(
        asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
          copyId,
          text: "note 31",
        }),
      ),
    ).toBe("RateLimited");
    expect(await countRows(t, "photoComments")).toBe(29);
    expect(await countRows(t, "puzzleComments")).toBe(1);

    // Another member's budget is their own.
    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "from bob",
    });

    // An hour later Alice may comment again.
    await expireWindow(t, "commentPost");
    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "next hour",
    });
    expect(await countRows(t, "photoComments")).toBe(31);
  });

  test("a refused comment (too long, unpublished photo) does not spend the budget", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);
    for (let i = 0; i < 40; i++) {
      await expect(
        asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
          photoId,
          text: "A".repeat(1001),
        }),
      ).rejects.toThrow();
    }
    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "still allowed",
    });
  });

  test("the 21st review in an hour is refused, both review forms together", async () => {
    const t = convexTest(schema, modules);
    const { puzzleId, copyId } = await seed(t);
    expect(RATE_LIMITS.reviewPost).toEqual({ windowMs: 3_600_000, max: 20 });

    for (let i = 0; i < 10; i++) {
      await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
        puzzleId,
        rating: (i % 5) + 1,
      });
      await asBob(t).mutation(api.solving.submitReviews.submitReviews, {
        puzzleId,
        puzzle: { rating: (i % 5) + 1, text: `edit ${i}` },
      });
    }
    expect(
      await codeOf(
        asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
          puzzleId,
          rating: 5,
        }),
      ),
    ).toBe("RateLimited");
    expect(
      await codeOf(
        asBob(t).mutation(api.solving.submitReviews.submitReviews, {
          puzzleId,
          puzzle: { rating: 5 },
        }),
      ),
    ).toBe("RateLimited");

    // A copy-only rating is not a puzzle review and is not counted.
    await asAlice(t).mutation(api.solving.submitReviews.submitReviews, {
      puzzleId,
      copyId,
      copy: { rating: 4 },
    });

    await expireWindow(t, "reviewPost");
    await asBob(t).mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 5,
    });
  });
});
