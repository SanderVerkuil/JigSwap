import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// An exchange thread's inbox subject projects the trading partner through the PER-TRADE rule
// (exchange/tradeParty): the owner always sees the requester inside the trade; the requester sees
// the owner only once the owner acted (a tradeReveals row). A trade-only reveal gets the LIMITED
// member view and never a profile link; a hidden party stays anonymous with the thread-salted ref.

const now = Date.now();

const seed = (
  t: TestConvex<typeof schema>,
  ownerVisibility: "public" | "private" = "private",
) =>
  t.run(async (ctx) => {
    const mk = (clerkId: string, extra: Partial<Doc<"users">>) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const owner = await mk("clerk_owner", {
      name: "Olga Ownername",
      username: "olgaowner",
      slug: "olga-slug",
      avatar: "https://img/olga.png",
    });
    const requester = await mk("clerk_req", {
      name: "Rita Requestername",
      username: "ritareq",
      slug: "rita-slug",
      avatar: "https://img/rita.png",
    });
    await ctx.db.insert("profiles", {
      memberId: owner,
      visibility: ownerVisibility,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: requester,
      visibility: "private",
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeId = await ctx.db.insert("exchanges", {
      aggregateId: "ex-1",
      initiatorId: requester,
      recipientId: owner,
      type: "trade",
      requestedPuzzleId: copyId,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
    const participants = [requester, owner];
    await ctx.db.insert("threads", {
      aggregateId: "thread-ex",
      subjectKind: "exchange",
      exchangeId,
      participants,
      participantsKey: [...participants].sort().join("|"),
      readReceipts: [],
      createdAt: now,
    });
    for (const memberId of participants) {
      await ctx.db.insert("threadParticipants", {
        threadAggregateId: "thread-ex",
        memberId,
      });
    }
    return { owner, requester, exchangeId };
  });

const subjectFor = async (t: TestConvex<typeof schema>, clerkId: string) => {
  const inbox = await t
    .withIdentity({ subject: clerkId })
    .query(api.conversation.getMyInbox.getMyInbox, {});
  expect(inbox).toHaveLength(1);
  const subject = inbox[0].subject;
  if (subject.kind !== "exchange") throw new Error("expected exchange");
  return { subject, json: JSON.stringify(inbox) };
};

describe("exchange-thread inbox subject: per-trade identity", () => {
  test("the owner sees the private requester inside the trade, limited and unlinked", async () => {
    const t = convexTest(schema, modules);
    const { requester } = await seed(t);
    const { subject, json } = await subjectFor(t, "clerk_owner");
    expect(subject.otherMember).toMatchObject({
      anonymous: false,
      member: { _id: requester, name: "Rita Requestername" },
    });
    if (subject.otherMember.anonymous) throw new Error("expected revealed");
    // Limited view: no avatar; and a trade reveal never unlocks the profile link.
    expect(subject.otherMember.member).not.toHaveProperty("avatar");
    expect(subject.profileHandle).toBeNull();
    expect(json).not.toContain("rita-slug");
  });

  test("the requester sees a private owner only after the owner acted", async () => {
    const t = convexTest(schema, modules);
    const { owner, exchangeId } = await seed(t);

    const before = await subjectFor(t, "clerk_req");
    expect(before.subject.otherMember).toEqual({
      anonymous: true,
      anonRef: expect.any(String),
    });
    expect(before.subject.profileHandle).toBeNull();
    for (const secret of [
      owner as string,
      "Olga",
      "Ownername",
      "olgaowner",
      "olga-slug",
      "olga.png",
    ]) {
      expect(before.json).not.toContain(secret);
    }

    await t.run((ctx) =>
      ctx.db.insert("tradeReveals", {
        exchangeId,
        reason: "owner_replied",
        revealedAt: now,
      }),
    );
    const after = await subjectFor(t, "clerk_req");
    expect(after.subject.otherMember).toMatchObject({
      anonymous: false,
      member: { _id: owner, name: "Olga Ownername" },
    });
    if (after.subject.otherMember.anonymous) throw new Error("revealed");
    expect(after.subject.otherMember.member).not.toHaveProperty("avatar");
    expect(after.subject.profileHandle).toBeNull();
    expect(after.json).not.toContain("olga-slug");
  });

  test("a public party is visible with the full view and a profile handle", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await seed(t, "public");
    const { subject } = await subjectFor(t, "clerk_req");
    expect(subject.otherMember).toMatchObject({
      anonymous: false,
      member: { _id: owner, avatar: "https://img/olga.png" },
    });
    expect(subject.profileHandle).toBe("olga-slug");
  });

  test("a departed partner is anonymous and flagged departed", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await seed(t, "public");
    await t.run((ctx) =>
      ctx.db.patch(owner as Id<"users">, { isActive: false }),
    );
    const { subject, json } = await subjectFor(t, "clerk_req");
    expect(subject.otherMember).toEqual({
      anonymous: true,
      anonRef: expect.any(String),
      departed: true,
    });
    expect(subject.profileHandle).toBeNull();
    expect(json).not.toContain(owner as string);
  });
});
