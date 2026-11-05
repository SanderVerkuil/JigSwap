import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-07: handles resolve id -> slug -> username, and setSlug refuses another member's EXISTING
// username, but a username that arrives later (Clerk webhook) is never checked against slugs. A
// slug squatted first would then capture every link built from the later member's username,
// including the canonical redirect from their own id/QR URL. Every handle the app hands out must
// resolve back to the member it names.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const now = Date.now();

const insertUser = (t: T, clerkId: string, extra: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...extra,
    }),
  );

const makePublic = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("profiles", {
      memberId,
      visibility: "public",
      updatedAt: now,
    }),
  );

// A Clerk user.created payload, as the webhook hands it to updateOrCreateUser.
const clerkUser = (id: string, username: string) => ({
  id,
  first_name: "Victor",
  last_name: "Victim",
  username,
  primary_email_address_id: `idn_${id}`,
  email_addresses: [
    {
      id: `idn_${id}`,
      email_address: `${id}@example.com`,
      verification: { status: "verified" as const },
    },
  ],
  image_url: "https://img.example/victim.png",
  created_at: now,
  updated_at: now,
  public_metadata: {},
});

// The attacker claims the slug "newbie"; later a real member signs up with Clerk username "newbie".
const squattedSetup = async () => {
  const t = convexTest(schema, modules);
  const attacker = await insertUser(t, "clerk_attacker", { name: "Newbie" });
  await t
    .withIdentity({ subject: "clerk_attacker" })
    .mutation(api.identity.setSlug.setSlug, { slug: "newbie" });
  await t.mutation(internal.users.updateOrCreateUser, {
    clerkUser: clerkUser("clerk_victim", "newbie"),
  });
  const victim = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_victim"))
      .unique();
    if (!row) throw new Error("victim not created");
    return row._id;
  });
  const viewer = await insertUser(t, "clerk_viewer");
  await makePublic(t, victim);
  return { t, attacker, victim, viewer };
};

const profileByHandle = (t: T, handle: string) =>
  t.query(api.social.getPublicProfile.getPublicProfile, { handle });

const teaserByHandle = (t: T, handle: string) =>
  t.query(api.social.getPublicMemberTeaser.getPublicMemberTeaser, { handle });

describe("canonical member handles (SEC-07)", () => {
  test("review repro: the victim's id URL canonicalises to their id, never to the squatted name", async () => {
    const { t, attacker, victim } = await squattedSetup();

    const byId = await profileByHandle(t, victim);
    expect(byId?.hero.memberId).toBe(victim);
    expect(byId?.hero.handle).toBe(victim);
    const byCanonical = await profileByHandle(t, byId!.hero.handle);
    expect(byCanonical?.hero.memberId).toBe(victim);

    const teaser = await teaserByHandle(t, victim);
    expect(teaser?.handle).toBe(victim);

    const me = await t
      .withIdentity({ subject: "clerk_victim" })
      .query(api.identity.getCurrentUser.getCurrentUser, {});
    expect(me?.handle).toBe(victim);

    // The squatter keeps their own slug, which resolves to them.
    const squatter = await profileByHandle(t, "newbie");
    expect(squatter?.hero.memberId).toBe(attacker);
    expect(squatter?.hero.handle).toBe("newbie");
  });

  test("every canonical handle resolves back to the member it names", async () => {
    const t = convexTest(schema, modules);
    const slugged = await insertUser(t, "clerk_slugged", {
      username: "slug_user",
      slug: "slug-member",
    });
    const named = await insertUser(t, "clerk_named", { username: "plainname" });
    const bare = await insertUser(t, "clerk_bare");
    // A username shaped like a users id is never handed out as a handle.
    const idShaped = await insertUser(t, "clerk_idshaped", { username: bare });
    for (const id of [slugged, named, bare, idShaped]) await makePublic(t, id);

    const expected = new Map<Id<"users">, string>([
      [slugged, "slug-member"],
      [named, "plainname"],
      [bare, bare],
      [idShaped, idShaped],
    ]);
    for (const [memberId, handle] of expected) {
      const viaId = await profileByHandle(t, memberId);
      expect(viaId?.hero.handle).toBe(handle);
      expect((await profileByHandle(t, handle))?.hero.memberId).toBe(memberId);
      const teaser = await teaserByHandle(t, memberId);
      expect(teaser?.handle).toBe(handle);
      expect((await teaserByHandle(t, handle))?.memberId).toBe(memberId);
    }
  });

  test("the blocker's profile stub carries the canonical handle too", async () => {
    const { t, victim } = await squattedSetup();
    await t
      .withIdentity({ subject: "clerk_viewer" })
      .mutation(api.social.blockMember.blockMember, { memberId: victim });
    const stub = await t
      .withIdentity({ subject: "clerk_viewer" })
      .query(api.social.getPublicProfile.getPublicProfile, { handle: victim });
    expect(stub?.locked && stub.blockedByMe).toBe(true);
    expect(stub?.hero.handle).toBe(victim);
  });

  test("links built elsewhere never use the squatted username", async () => {
    const { t, victim, viewer } = await squattedSetup();
    const asViewer = t.withIdentity({ subject: "clerk_viewer" });
    // Mutual followers, so the victim is revealed and linkable everywhere below.
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: viewer,
        followeeId: victim,
        createdAt: now,
      });
      await ctx.db.insert("follows", {
        followerId: victim,
        followeeId: viewer,
        createdAt: now,
      });
    });

    // Inbox (DM subject).
    await asViewer.mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: victim,
    });
    const [row] = await asViewer.query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    if (row?.subject.kind !== "dm") throw new Error("expected a dm subject");
    expect(row.subject.profileHandle).toBe(victim);

    // Notification actor handle and row link.
    await t.run((ctx) =>
      ctx.db.insert("notifications", {
        aggregateId: "notif-victim-follow",
        userId: viewer,
        type: "new_follower",
        channel: "inApp",
        actorIds: [victim],
        actorCount: 1,
        isRead: false,
        createdAt: now,
      }),
    );
    const views = await asViewer.query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    const view = views.page[0]!;
    expect(view.actors[0]).toMatchObject({ anonymous: false, handle: victim });
    expect(view.href).toBe(`/members/${victim}`);

    // People search.
    const results = await asViewer.query(api.search.globalSearch.global, {
      term: "newbie",
    });
    const hit = results.people.find((p) => p.id === victim);
    expect(hit?.href).toBe(`/members/${victim}`);

    // Pending follow request preview.
    await t.run((ctx) =>
      ctx.db.insert("followRequests", {
        aggregateId: "req-victim-viewer",
        requesterId: victim,
        targetId: viewer,
        status: "pending",
        createdAt: now,
      }),
    );
    const preview = await asViewer.query(
      api.social.getFollowRequesterPreview.getFollowRequesterPreview,
      { requesterId: victim },
    );
    expect(preview?.handle).toBe(victim);

    // The blocker's own block list.
    await asViewer.mutation(api.social.blockMember.blockMember, {
      memberId: victim,
    });
    const blocks = await asViewer.query(
      api.social.listMyBlocks.listMyBlocks,
      {},
    );
    expect(blocks.find((b) => b.memberId === victim)?.handle).toBe(victim);
  });

  test("the trade card names a partner only by a handle that resolves back to them", async () => {
    const { t, victim, viewer } = await squattedSetup();
    const plain = await insertUser(t, "clerk_plain", { username: "plainname" });
    const slugged = await insertUser(t, "clerk_slugged", {
      username: "slug_user",
      slug: "slug-member",
    });
    const tradeWith = (owner: Id<"users">) =>
      t.run(async (ctx) => {
        const puzzleId = await ctx.db.insert("puzzles", {
          title: "Harbour Lights",
          pieceCount: 1000,
          status: "approved",
          submittedBy: owner,
          createdAt: now,
          updatedAt: now,
        });
        const copy = await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: true, forSale: false, forLend: false },
          createdAt: now,
          updatedAt: now,
        });
        const exchangeId = await ctx.db.insert("exchanges", {
          initiatorId: viewer,
          recipientId: owner,
          type: "trade",
          requestedPuzzleId: copy,
          status: "accepted",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("tradeReveals", {
          exchangeId,
          reason: "accepted",
          revealedAt: now,
        });
        return exchangeId;
      });
    const handleOnCard = async (owner: Id<"users">) => {
      const card = await t
        .withIdentity({ subject: "clerk_viewer" })
        .query(api.exchange.getTradePartner.getTradePartner, {
          exchangeId: await tradeWith(owner),
        });
      if (card?.state !== "revealed")
        throw new Error("expected a revealed card");
      return card.handle;
    };

    // The victim's username is the squatter's slug: the card hands out their id instead.
    expect(await handleOnCard(victim)).toBe(victim);
    expect(await handleOnCard(plain)).toBe("plainname");
    expect(await handleOnCard(slugged)).toBe("slug-member");
  });

  test("a member with a slug is linked by the slug everywhere", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_viewer");
    const member = await insertUser(t, "clerk_member", {
      username: "member_u",
      slug: "member-slug",
    });
    await makePublic(t, member);
    const asViewer = t.withIdentity({ subject: "clerk_viewer" });
    await asViewer.mutation(api.social.blockMember.blockMember, {
      memberId: member,
    });
    const blocks = await asViewer.query(
      api.social.listMyBlocks.listMyBlocks,
      {},
    );
    expect(blocks[0]?.handle).toBe("member-slug");
  });
});
