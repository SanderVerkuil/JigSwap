import type { MemberView } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The ghost "Deleted member" (spec 2026-10-19): every surface that shows content a member left
// behind (reviews, comments, trade reviews, catalog contributions, activity, loans) must yield the
// departed state once their users row is gone or tombstoned: no name, avatar or profile link.
// Their profile row is purged later by purgeMemberMessagingData, so it is still here in these
// tests, as it is for a while in production.

const DORA = "Dora Departed";

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (key: string, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${key}`,
        email: `${key}@example.com`,
        name,
        username: key,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const viewer = await mkUser("viewer", "Vera Viewer");
    const partner = await mkUser("partner", "Pim Partner");
    const dora = await mkUser("dora", DORA);
    // Only Dora carries the optional profile fields, so any of them in a payload is hers.
    await ctx.db.patch(dora, {
      avatar: "https://img.example.com/dora.png",
      bio: "Dora bio",
      location: "Utrecht",
      preferredLanguage: "nl",
    });
    await ctx.db.insert("profiles", {
      memberId: dora,
      displayName: DORA,
      visibility: "public",
      updatedAt: now,
    });
    // The viewer follows Dora, so Dora's activity is in the viewer's feed audience.
    await ctx.db.insert("follows", {
      followerId: viewer,
      followeeId: dora,
      createdAt: now,
    });

    // A catalog puzzle Dora submitted, reviewed by her.
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: dora,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("puzzleReviews", {
      userId: dora,
      puzzleId,
      rating: 4,
      text: "Lovely sky",
      createdAt: now,
      updatedAt: now,
    });

    // The viewer's copy, with Dora's comment on it and on one of its photos.
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleId,
      ownerId: viewer,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("puzzleComments", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      copyId: copy,
      authorId: dora,
      text: "Nice copy",
      createdAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["img"], { type: "image/png" }),
    );
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: viewer,
      fileId,
      title: "Box front",
      tag: "box_front",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("photoComments", {
      aggregateId: crypto.randomUUID(),
      photoId,
      authorId: dora,
      text: "Great photo",
      createdAt: now,
    });

    // Dora traded with Pim and reviewed him; the viewer is now trading with Pim.
    const mkExchange = (initiatorId: Id<"users">, recipientId: Id<"users">) =>
      ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        initiatorId,
        recipientId,
        type: "sale",
        requestedPuzzleId: copy,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
    const doraExchange = await mkExchange(dora, partner);
    const viewerExchange = await mkExchange(viewer, partner);
    await ctx.db.insert("reviews", {
      aggregateId: crypto.randomUUID(),
      exchangeId: doraExchange,
      reviewerId: dora,
      revieweeId: partner,
      rating: 5,
      comment: "Smooth trade",
      categories: {
        communication: 5,
        packaging: 5,
        condition: 5,
        timeliness: 5,
      },
      createdAt: now,
    });

    // Dora's recent solve, in the viewer's feed.
    await ctx.db.insert("domainEvents", {
      name: "CompletionRecorded",
      payload: { userId: dora, completionId: crypto.randomUUID() },
      occurredAt: now,
      context: "solving",
    });

    // Dora lent the viewer a copy that is still out.
    await ctx.db.insert("loans", {
      aggregateId: crypto.randomUUID(),
      copyId: copyAggregateId,
      lenderId: dora,
      borrowerId: viewer,
      status: "open",
      openedAt: now,
    });

    return { viewer, partner, dora, puzzleId, copy, photoId, viewerExchange };
  });

const departures = {
  deleted: async (t: TestConvex<typeof schema>, dora: Id<"users">) =>
    t.run((ctx) => ctx.db.delete(dora)),
  // users.deleteUser's tombstone under an open CSAM escalation.
  tombstoned: async (t: TestConvex<typeof schema>, dora: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.patch(dora, {
        isActive: false,
        email: undefined,
        name: undefined,
        username: undefined,
        slug: undefined,
        avatar: undefined,
        bio: undefined,
        location: undefined,
        searchableName: undefined,
      }),
    ),
};

// Nothing that identifies Dora: no name (account or profile), username, avatar, bio, location or
// language. `_id` is part of the MemberView contract for every author, so it is not checked here.
const expectNoIdentity = (value: unknown) => {
  const json = JSON.stringify(value);
  for (const leak of [
    DORA,
    '"dora"',
    "dora@",
    "/dora.png",
    "Utrecht",
    '"nl"',
  ]) {
    expect(json).not.toContain(leak);
  }
};

// The departed MemberView shape the review/comment lists emit.
const expectDepartedAuthor = (author: MemberView) => {
  expect(author.isActive).toBe(false);
  for (const field of [
    "name",
    "username",
    "avatar",
    "bio",
    "location",
    "preferredLanguage",
  ] as const) {
    expect(author[field]).toBeUndefined();
  }
};

describe.each(Object.keys(departures) as (keyof typeof departures)[])(
  "a %s member renders as the ghost",
  (departure) => {
    const setup = async () => {
      const t = convexTest(schema, modules);
      const ids = await seed(t);
      await departures[departure](t, ids.dora);
      return {
        t,
        ...ids,
        asViewer: t.withIdentity({ subject: "clerk_viewer" }),
      };
    };

    test("puzzle reviews", async () => {
      const { asViewer, puzzleId } = await setup();
      const reviews = await asViewer.query(
        api.social.listPuzzleReviews.listPuzzleReviews,
        { puzzleId },
      );
      expect(reviews).toHaveLength(1);
      expectDepartedAuthor(reviews[0].author);
      expectNoIdentity(reviews);
    });

    test("copy comments", async () => {
      const { asViewer, copy } = await setup();
      const comments = await asViewer.query(
        api.social.listPuzzleComments.listPuzzleComments,
        { copyId: copy },
      );
      expect(comments).toHaveLength(1);
      expectDepartedAuthor(comments[0].author);
      expectNoIdentity(comments);
    });

    test("photo comments", async () => {
      const { asViewer, photoId } = await setup();
      const comments = await asViewer.query(
        api.library.listPhotoComments.listPhotoComments,
        { photoId },
      );
      expect(comments).toHaveLength(1);
      expectDepartedAuthor(comments[0].author);
      expectNoIdentity(comments);
    });

    test("trade reviews listed for a member", async () => {
      const { asViewer, partner, dora } = await setup();
      const reviews = await asViewer.query(
        api.reputation.listReviewsForMember.listReviewsForMember,
        { memberId: partner },
      );
      expect(reviews).toHaveLength(1);
      expect(reviews[0].reviewer).toMatchObject({
        anonymous: true,
        departed: true,
      });
      expect(JSON.stringify(reviews)).not.toContain(dora);
      expectNoIdentity(reviews);
    });

    test("catalog contributions never carry the submitter", async () => {
      const { asViewer, puzzleId, dora } = await setup();
      const puzzle = await asViewer.query(
        api.catalog.getPuzzleById.getPuzzleById,
        { puzzleId },
      );
      expect(puzzle).not.toBeNull();
      expect(JSON.stringify(puzzle)).not.toContain(dora);
      expectNoIdentity(puzzle);
    });

    test("trade reviews on a partner card are marked departed", async () => {
      const { asViewer, viewerExchange } = await setup();
      const partner = await asViewer.query(
        api.exchange.getTradePartner.getTradePartner,
        { exchangeId: viewerExchange },
      );
      if (partner?.state !== "revealed") throw new Error("partner hidden");
      expect(partner.reviews.items).toHaveLength(1);
      const [review] = partner.reviews.items;
      expect(review.reviewerName).toBeUndefined();
      expect(review.reviewerDeparted).toBe(true);
      expectNoIdentity(partner.reviews);
    });

    test("activity feed entries are marked departed, unnamed and unlinked", async () => {
      const { asViewer, dora } = await setup();
      const feed = await asViewer.query(
        api.social.getActivityFeed.getActivityFeed,
        {},
      );
      const entry = feed.find((e) => e.memberId === (dora as string));
      expect(entry).toBeDefined();
      expect(entry!.actorName).toBeUndefined();
      expect(entry!.actor).toBeUndefined();
      expect(entry!.actorDeparted).toBe(true);
      expectNoIdentity(feed);
    });

    test("public review authors are anonymous", async () => {
      const { t, puzzleId } = await setup();
      const reviews = await t.query(
        api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
        { puzzleId },
      );
      expect(reviews).toHaveLength(1);
      expect(reviews[0].author).toBeNull();
    });
  },
);
