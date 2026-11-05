import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-12 (SOC-1, SURF-10): the reviews a member RECEIVED are an explicit DTO (id, rating,
// categories, comment, createdAt, projected reviewer), never the stored row, so no exchange id,
// reviewee id or aggregate id can correlate two members' lists into the trade graph and name an
// anonymous reviewer. The reviewee is gated like getUserStats: a member who blocked the viewer
// shows no reviews and a zero reputation, and a private member's received reviews reach only
// themself and their mutual followers. A stranger reading the private member's list would
// otherwise see the (named) public partner and so learn who the anonymous reviewer on that
// partner's list is.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const PUB_COMMENT = "public member's received comment";
const PRIV_COMMENT = "private member's received comment";
const scores = { communication: 5, packaging: 4, condition: 5, timeliness: 4 };

// pub (public) and priv (private) completed one exchange and reviewed each other; viewer is a
// third member with no connection to either.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (key: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${key}`,
        email: `${key}@example.com`,
        name: key,
        username: key,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const pub = await mkUser("pub");
    const priv = await mkUser("priv");
    const viewer = await mkUser("viewer");
    await ctx.db.insert("profiles", {
      memberId: pub,
      visibility: "public",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: priv,
      visibility: "private",
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: pub,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleId,
      ownerId: pub,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeId = await ctx.db.insert("exchanges", {
      aggregateId: crypto.randomUUID(),
      initiatorId: priv,
      recipientId: pub,
      type: "trade",
      requestedPuzzleId: copy,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    const review = (
      reviewerId: Id<"users">,
      revieweeId: Id<"users">,
      comment: string,
    ) =>
      ctx.db.insert("reviews", {
        aggregateId: crypto.randomUUID(),
        exchangeId,
        reviewerId,
        revieweeId,
        rating: 4,
        comment,
        categories: scores,
        createdAt: now,
      });
    await review(priv, pub, PUB_COMMENT);
    await review(pub, priv, PRIV_COMMENT);
    for (const memberId of [pub, priv]) {
      await ctx.db.insert("reputationProfiles", {
        memberId,
        ratingSum: 4,
        reviewCount: 1,
        averageRating: 4,
        credibility: 0.2,
        updatedAt: now,
      });
    }
    return { pub, priv, viewer, exchangeId };
  });

const as = (t: T, key: string) => t.withIdentity({ subject: `clerk_${key}` });

const listFor = (t: T, key: string, memberId: Id<"users">) =>
  as(t, key).query(api.reputation.listReviewsForMember.listReviewsForMember, {
    memberId,
  });

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", { followerId, followeeId, createdAt: Date.now() }),
  );

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

describe("listReviewsForMember (SEC-12)", () => {
  test("returns only the explicit review DTO, so two lists can't be joined on the exchange", async () => {
    const t = convexTest(schema, modules);
    const { pub, priv, exchangeId } = await seed(t);

    const onPub = await listFor(t, "viewer", pub);
    // priv's own read of their list, so both sides carry a row to compare.
    const onPriv = await listFor(t, "priv", priv);
    expect(onPub).toHaveLength(1);
    expect(onPriv).toHaveLength(1);
    const keys = ["categories", "comment", "createdAt", "id", "rating"];
    expect(Object.keys(onPub[0]).sort()).toEqual([...keys, "reviewer"].sort());
    expect(Object.keys(onPriv[0]).sort()).toEqual([...keys, "reviewer"].sort());
    for (const json of [JSON.stringify(onPub), JSON.stringify(onPriv)]) {
      expect(json).not.toContain(exchangeId);
      expect(json).not.toContain("exchangeId");
      expect(json).not.toContain("revieweeId");
      expect(json).not.toContain("aggregateId");
    }
    // The private reviewer stays anonymous on the public member's list, and nothing on it leads
    // back to them.
    expect(onPub[0].reviewer.anonymous).toBe(true);
    expect(JSON.stringify(onPub)).not.toContain(priv);
    expect(onPub[0].comment).toBe(PUB_COMMENT);
    expect(onPub[0].categories).toEqual(scores);
  });

  test("a private member's received reviews reach only themself and mutual followers", async () => {
    const t = convexTest(schema, modules);
    const { priv, viewer } = await seed(t);

    // A stranger and a one-way follower read nothing: not the comment, and not the reviewer.
    expect(await listFor(t, "viewer", priv)).toEqual([]);
    await follow(t, viewer, priv);
    expect(await listFor(t, "viewer", priv)).toEqual([]);

    // Mutual followers and the member themself read it.
    await follow(t, priv, viewer);
    expect((await listFor(t, "viewer", priv))[0].comment).toBe(PRIV_COMMENT);
    expect((await listFor(t, "priv", priv))[0].comment).toBe(PRIV_COMMENT);
  });

  test("a stranger can't name the anonymous reviewer through the private partner's list", async () => {
    const t = convexTest(schema, modules);
    const { pub, priv } = await seed(t);

    // On pub's list priv is anonymous. Reading priv's list must not then name pub as priv's
    // partner, which would tell the stranger who that anonymous reviewer is.
    const onPub = await listFor(t, "viewer", pub);
    expect(onPub[0].reviewer.anonymous).toBe(true);
    const onPriv = await listFor(t, "viewer", priv);
    expect(onPriv).toEqual([]);
    const json = JSON.stringify(onPriv);
    expect(json).not.toContain(pub);
    expect(json).not.toContain('"pub"');
  });

  test("a member who blocked the viewer shows no reviews and a zero reputation", async () => {
    const t = convexTest(schema, modules);
    const { pub, viewer } = await seed(t);
    expect(await listFor(t, "viewer", pub)).toHaveLength(1);
    expect(
      (
        await as(t, "viewer").query(
          api.reputation.getReputationProfile.getReputationProfile,
          { memberId: pub },
        )
      ).reviewCount,
    ).toBe(1);

    await block(t, pub, viewer);
    expect(await listFor(t, "viewer", pub)).toEqual([]);
    expect(
      await as(t, "viewer").query(
        api.reputation.getReputationProfile.getReputationProfile,
        { memberId: pub },
      ),
    ).toEqual({
      memberId: pub,
      ratingSum: 0,
      reviewCount: 0,
      averageRating: 0,
      credibility: 0,
      updatedAt: 0,
    });
  });

  test("a mutual block hides them too; the viewer's own block alone does not", async () => {
    const t = convexTest(schema, modules);
    const { pub, viewer } = await seed(t);
    await block(t, viewer, pub);
    expect(await listFor(t, "viewer", pub)).toHaveLength(1);
    await block(t, pub, viewer);
    expect(await listFor(t, "viewer", pub)).toEqual([]);
    expect(
      (
        await as(t, "viewer").query(
          api.reputation.getReputationProfile.getReputationProfile,
          { memberId: pub },
        )
      ).reviewCount,
    ).toBe(0);
  });
});
