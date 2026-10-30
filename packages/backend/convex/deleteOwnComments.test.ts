import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-70: a member can delete the comments they wrote — the copy notes (puzzleComments) and the
// photo discussion (photoComments) — and nobody else's. The list views say which rows the viewer
// may delete (`canDelete`), computed server-side.

// Two members; Alice owns an OPEN copy (reachable by Bob through canViewCopy) with one photo.
const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com", "Alice");
    const bob = await mkUser("clerk_bob", "bob@example.com", "Bob");
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
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
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["fake-image-bytes"], { type: "image/png" }),
    );
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId,
      title: "Box front",
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, puzzleId, copy, photoId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

const codeOf = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      if (typeof data === "object" && data !== null && "code" in data) {
        return String(data.code);
      }
      return String(data);
    }
    throw error;
  }
};

describe("deletePuzzleComment (copy notes)", () => {
  test("the author deletes their own comment; it is gone from the table and the list", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: copy,
      text: "Missing one edge piece",
    });
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: copy,
      text: "Box slightly dented",
    });

    const before = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: copy },
    );
    expect(before.map((c) => c.canDelete)).toEqual([true, true]);
    const target = before.find((c) => c.text === "Missing one edge piece");
    if (!target) throw new Error("seeded comment missing");

    await asAlice(t).mutation(
      api.social.deletePuzzleComment.deletePuzzleComment,
      { commentId: target.id },
    );

    const rows = await t.run((ctx) => ctx.db.query("puzzleComments").collect());
    expect(rows.map((r) => r.text)).toEqual(["Box slightly dented"]);
    const after = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: copy },
    );
    expect(after.map((c) => c.text)).toEqual(["Box slightly dented"]);
  });

  test("another member can neither delete it nor is offered to", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: copy,
      text: "Owner's note",
    });

    const asSeenByBob = await asBob(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: copy },
    );
    expect(asSeenByBob).toHaveLength(1);
    expect(asSeenByBob[0].canDelete).toBe(false);

    expect(
      await codeOf(
        asBob(t).mutation(api.social.deletePuzzleComment.deletePuzzleComment, {
          commentId: asSeenByBob[0].id,
        }),
      ),
    ).toBe("NotCommentAuthor");
    const rows = await t.run((ctx) => ctx.db.query("puzzleComments").collect());
    expect(rows).toHaveLength(1);
  });

  test("an unknown id answers CommentNotFound and a signed-out caller is refused", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    await asAlice(t).mutation(api.social.postPuzzleComment.postPuzzleComment, {
      copyId: copy,
      text: "Owner's note",
    });
    const [comment] = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: copy },
    );

    expect(
      await codeOf(
        asAlice(t).mutation(
          api.social.deletePuzzleComment.deletePuzzleComment,
          { commentId: "no-such-comment" },
        ),
      ),
    ).toBe("CommentNotFound");
    await expect(
      t.mutation(api.social.deletePuzzleComment.deletePuzzleComment, {
        commentId: comment.id,
      }),
    ).rejects.toThrow();
    const rows = await t.run((ctx) => ctx.db.query("puzzleComments").collect());
    expect(rows).toHaveLength(1);
  });

  test("a legacy row without an aggregateId is deleted by the id the list shows (its _id)", async () => {
    const t = convexTest(schema, modules);
    const { alice, puzzleId, copy } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("puzzleComments", {
        puzzleId,
        copyId: copy,
        authorId: alice,
        text: "Written before aggregate ids",
        createdAt: Date.now(),
      }),
    );
    const [legacy] = await asAlice(t).query(
      api.social.listPuzzleComments.listPuzzleComments,
      { copyId: copy },
    );
    expect(legacy.canDelete).toBe(true);

    await asAlice(t).mutation(
      api.social.deletePuzzleComment.deletePuzzleComment,
      { commentId: legacy.id },
    );

    const rows = await t.run((ctx) => ctx.db.query("puzzleComments").collect());
    expect(rows).toHaveLength(0);
  });
});

describe("deletePhotoComment (photo discussion)", () => {
  test("a commenter deletes their own comment on someone else's photo", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);
    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "Great colours",
    });
    await asAlice(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "Thanks!",
    });

    const asSeenByBob = await asBob(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    const byText = new Map(asSeenByBob.map((c) => [c.text, c]));
    expect(byText.get("Great colours")?.canDelete).toBe(true);
    expect(byText.get("Thanks!")?.canDelete).toBe(false);

    const own = byText.get("Great colours");
    if (!own) throw new Error("seeded comment missing");
    await asBob(t).mutation(api.library.deletePhotoComment.deletePhotoComment, {
      commentId: own.id,
    });

    const rows = await t.run((ctx) => ctx.db.query("photoComments").collect());
    expect(rows.map((r) => r.text)).toEqual(["Thanks!"]);
  });

  test("the photo's owner cannot delete a comment someone else wrote", async () => {
    const t = convexTest(schema, modules);
    const { photoId } = await seed(t);
    await asBob(t).mutation(api.library.postPhotoComment.postPhotoComment, {
      photoId,
      text: "Great colours",
    });
    const [comment] = await asAlice(t).query(
      api.library.listPhotoComments.listPhotoComments,
      { photoId },
    );
    expect(comment.canDelete).toBe(false);

    expect(
      await codeOf(
        asAlice(t).mutation(api.library.deletePhotoComment.deletePhotoComment, {
          commentId: comment.id,
        }),
      ),
    ).toBe("NotCommentAuthor");
    expect(
      await codeOf(
        asAlice(t).mutation(api.library.deletePhotoComment.deletePhotoComment, {
          commentId: "no-such-comment",
        }),
      ),
    ).toBe("CommentNotFound");
    const rows = await t.run((ctx) => ctx.db.query("photoComments").collect());
    expect(rows).toHaveLength(1);
  });
});
