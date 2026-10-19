import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Ask to join a household (spec 2026-10-19 household redesign §3, "Request to join"): only from an
// expired or used household invite link; the requester always gets the same answer, and a request
// that must not reach anyone (household gone, owner no longer admin, blocked) is kept as dropped.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat" | "dan";

const DAY_MS = 24 * 60 * 60 * 1000;

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
    return {
      ann: await mkUser("clerk_ann", "Ann"),
      bob: await mkUser("clerk_bob", "Bob"),
      cat: await mkUser("clerk_cat", "Cat"),
      dan: await mkUser("clerk_dan", "Dan"),
    };
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

const createHousehold = (t: T, who: Who) =>
  as(t, who).mutation(api.household.createHousehold.createHousehold, {});

const mint = async (t: T, who: Who = "ann") =>
  (
    await as(t, who).mutation(
      api.social.createHouseholdInviteLink.createHouseholdInviteLink,
      {},
    )
  ).token;

const patchLink = (
  t: T,
  token: string,
  patch: { expiresAt?: number; consumedAt?: number },
) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (row) await ctx.db.patch(row._id, patch);
  });

const expire = (t: T, token: string) =>
  patchLink(t, token, { expiresAt: Date.now() - 1 });

// An expired link minted by Ann (her household's admin).
const expiredLink = async (t: T, who: Who = "ann") => {
  const token = await mint(t, who);
  await expire(t, token);
  return token;
};

const invite = async (
  t: T,
  admin: Who,
  invitee: Who,
  inviteeId: Id<"users">,
) => {
  const inviteId = await as(t, admin).mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId },
  );
  await as(t, invitee).mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
};

const ask = (t: T, who: Who, token: string, leaveCurrentHousehold?: boolean) =>
  as(t, who).mutation(
    api.household.requestToJoinHousehold.requestToJoinHousehold,
    {
      token,
      ...(leaveCurrentHousehold !== undefined && { leaveCurrentHousehold }),
    },
  );

const approve = (t: T, who: Who, requestId: string) =>
  as(t, who).mutation(api.household.approveJoinRequest.approveJoinRequest, {
    requestId,
  });
const decline = (t: T, who: Who, requestId: string) =>
  as(t, who).mutation(api.household.declineJoinRequest.declineJoinRequest, {
    requestId,
  });
const withdraw = (t: T, who: Who, requestId: string) =>
  as(t, who).mutation(api.household.withdrawJoinRequest.withdrawJoinRequest, {
    requestId,
  });

const landing = (t: T, who: Who, token: string) =>
  as(t, who).query(api.social.getHouseholdLinkInvite.getHouseholdLinkInvite, {
    token,
  });
const myRequest = (t: T, who: Who) =>
  as(t, who).query(api.household.myJoinRequest.myJoinRequest, {});
const mine = (t: T, who: Who) =>
  as(t, who).query(api.household.getMyHousehold.getMyHousehold, {});

const views = async (t: T, who: Who) =>
  (
    await as(t, who).query(
      api.notifications.listMyNotificationViews.listMyNotificationViews,
      { paginationOpts: { numItems: 50, cursor: null } },
    )
  ).page;
const viewsOfType = async (t: T, who: Who, type: string) =>
  (await views(t, who)).filter((v) => v.type === type);

const requestRow = (t: T, requestId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("householdJoinRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", requestId))
      .unique(),
  );

const householdOf = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("householdMembers")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .collect()
    ).map((m) => ({ householdId: m.householdId, role: m.role })),
  );

describe("requestToJoinHousehold", () => {
  test("from an expired link: the admin is told and lists it, the requester sees it waiting", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);

    const before = Date.now();
    const { requestId } = await ask(t, "bob", token);
    const row = await requestRow(t, requestId);
    expect(row).toMatchObject({ status: "pending", dropped: false });
    expect(row?.leaveHouseholdId).toBeUndefined();
    expect(row!.expiresAt - row!.createdAt).toBe(14 * DAY_MS);

    expect(await landing(t, "bob", token)).toEqual({
      state: "expired",
      joinRequest: { status: "pending", requestId, expiresAt: row!.expiresAt },
    });
    const own = await myRequest(t, "bob");
    expect(own).toMatchObject({
      requestId,
      expiresAt: row!.expiresAt,
      inviter: { name: "Ann" },
    });
    expect(own!.createdAt).toBeGreaterThanOrEqual(before);
    expect((await mine(t, "ann"))?.joinRequests).toEqual([
      {
        requestId,
        requester: { memberId: bob, name: "Bob" },
        createdAt: row!.createdAt,
      },
    ]);

    await flushScheduled(t);
    const [notice] = await viewsOfType(
      t,
      "ann",
      "household_join_request_received",
    );
    expect(notice).toMatchObject({
      actors: [{ anonymous: false, memberId: bob }],
      href: "/household?tab=members",
      state: "informational",
      availableActions: [],
    });
  });

  test("from a used link", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const token = await mint(t);
    await patchLink(t, token, { consumedAt: Date.now() });

    const { requestId } = await ask(t, "bob", token);
    expect(await landing(t, "bob", token)).toMatchObject({
      state: "used",
      joinRequest: { status: "pending", requestId },
    });
  });

  test("is refused on unknown, revoked, network, own and live links", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const revoked = await mint(t);
    await as(t, "ann").mutation(
      api.social.revokeHouseholdInviteLinks.revokeHouseholdInviteLinks,
      {},
    );
    const { token: network } = await as(t, "ann").mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const live = await mint(t);
    const own = await expiredLink(t);

    await expectConvexCode(ask(t, "bob", "nope"), "InviteLinkInvalid");
    await expectConvexCode(ask(t, "bob", revoked), "InviteLinkInvalid");
    await expectConvexCode(ask(t, "bob", network), "InviteLinkInvalid");
    await expectConvexCode(ask(t, "bob", live), "InviteLinkLive");
    await expectConvexCode(ask(t, "ann", own), "OwnInviteLink");
    expect(
      await t.run((ctx) => ctx.db.query("householdJoinRequests").collect()),
    ).toEqual([]);
    expect(await landing(t, "bob", live)).toEqual({
      state: "can-accept",
      inviterName: "Ann",
    });
  });

  describe("dropped: the same answer, but no admin ever sees it", () => {
    const expectDropped = async (
      t: T,
      who: Who,
      token: string,
      admins: Who[],
    ) => {
      const answer = await ask(t, who, token);
      expect(Object.keys(answer)).toEqual(["requestId"]);
      expect((await requestRow(t, answer.requestId))?.dropped).toBe(true);
      // The requester sees it exactly like a delivered one.
      expect((await landing(t, who, token)).joinRequest).toEqual({
        status: "pending",
        requestId: answer.requestId,
        expiresAt: (await requestRow(t, answer.requestId))!.expiresAt,
      });
      expect((await myRequest(t, who))?.requestId).toBe(answer.requestId);
      await flushScheduled(t);
      for (const admin of admins) {
        expect((await mine(t, admin))?.joinRequests ?? []).toEqual([]);
        expect(
          await viewsOfType(t, admin, "household_join_request_received"),
        ).toEqual([]);
      }
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("notifications")
            .withIndex("by_type", (q) =>
              q.eq("type", "household_join_request_received"),
            )
            .collect(),
        ),
      ).toEqual([]);
      return answer.requestId;
    };

    test("when the household was dissolved", async () => {
      const t = convexTest(schema, modules);
      await seed(t);
      await createHousehold(t, "ann");
      const token = await expiredLink(t);
      await as(t, "ann").mutation(
        api.household.leaveHousehold.leaveHousehold,
        {},
      );
      await createHousehold(t, "ann");

      await expectDropped(t, "bob", token, ["ann"]);
    });

    test("when the link's owner is no longer its admin", async () => {
      const t = convexTest(schema, modules);
      const { cat } = await seed(t);
      await createHousehold(t, "ann");
      await invite(t, "ann", "cat", cat);
      const token = await expiredLink(t);
      // Ann leaves: Cat takes over the household.
      await as(t, "ann").mutation(
        api.household.leaveHousehold.leaveHousehold,
        {},
      );

      const requestId = await expectDropped(t, "dan", token, ["cat"]);
      expect(await approve(t, "cat", requestId)).toEqual({ outcome: "closed" });
    });

    test("when the pair is blocked either way", async () => {
      const t = convexTest(schema, modules);
      const { bob } = await seed(t);
      await createHousehold(t, "ann");
      const token = await expiredLink(t);
      await as(t, "ann").mutation(api.social.blockMember.blockMember, {
        memberId: bob,
      });

      await expectDropped(t, "bob", token, ["ann"]);
    });
  });

  test("one request per link, ever", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await withdraw(t, "bob", requestId);

    await expectConvexCode(ask(t, "bob", token), "JoinRequestAlreadySent");
    expect((await landing(t, "bob", token)).joinRequest).toEqual({
      status: "closed",
    });
  });

  test("one open request at a time", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    await createHousehold(t, "cat");
    const first = await expiredLink(t, "ann");
    const second = await expiredLink(t, "cat");
    await ask(t, "bob", first);

    await expectConvexCode(ask(t, "bob", second), "JoinRequestOpen");
    expect((await landing(t, "bob", second)).joinRequest).toEqual({
      status: "none",
    });
  });

  test("is rate limited before any lookup", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `householdJoinRequest:${bob}`,
        windowStart: Date.now(),
        count: 10,
      }),
    );
    await expectConvexCode(ask(t, "bob", "nope"), "RateLimited");
  });

  test("a member in a household must consent to leaving it", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await createHousehold(t, "ann");
    const bobHousehold = await createHousehold(t, "bob");
    const token = await expiredLink(t);

    await expectConvexCode(ask(t, "bob", token), "AlreadyInHousehold");
    const { requestId } = await ask(t, "bob", token, true);
    expect(await requestRow(t, requestId)).toMatchObject({
      leaveHouseholdId: bobHousehold,
      leaveConsequence: "deleted",
      requesterId: bob,
    });
  });
});

describe("getHouseholdLinkInvite own-household", () => {
  test("a member of the link's household is told so, live or not", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    await createHousehold(t, "ann");
    await invite(t, "ann", "cat", cat);
    const live = await mint(t);
    const expired = await expiredLink(t);

    expect(await landing(t, "cat", live)).toEqual({ state: "own-household" });
    expect(await landing(t, "cat", expired)).toEqual({
      state: "own-household",
    });
    await expectConvexCode(
      as(t, "cat").mutation(
        api.social.acceptHouseholdLinkInvite.acceptHouseholdLinkInvite,
        { token: live, leaveCurrentHousehold: true },
      ),
      "AlreadyMember",
    );
    await expectConvexCode(ask(t, "cat", expired), "AlreadyMember");
    // Non-members still see the expiry first.
    expect((await landing(t, "bob", expired)).state).toBe("expired");
  });
});

describe("approveJoinRequest", () => {
  test("lets a requester without a household in and tells them", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    const householdId = await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await flushScheduled(t);

    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "joined" });
    expect(await householdOf(t, bob)).toEqual([
      { householdId, role: "member" },
    ]);
    expect((await requestRow(t, requestId))?.status).toBe("approved");
    expect(await myRequest(t, "bob")).toBeNull();
    expect((await mine(t, "ann"))?.joinRequests).toEqual([]);

    await flushScheduled(t);
    const [approved] = await viewsOfType(
      t,
      "bob",
      "household_join_request_approved",
    );
    expect(approved).toMatchObject({
      actors: [{ anonymous: false, memberId: ann }],
      href: "/household",
    });
    const [received] = await viewsOfType(
      t,
      "ann",
      "household_join_request_received",
    );
    expect(received).toMatchObject({
      state: "resolved",
      resolvedAs: "approved",
    });
  });

  test("switches a sole member: their household is dissolved", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const householdId = await createHousehold(t, "ann");
    const bobHousehold = await createHousehold(t, "bob");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token, true);

    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "joined" });
    expect(await householdOf(t, bob)).toEqual([
      { householdId, role: "member" },
    ]);
    const households = await t.run((ctx) =>
      ctx.db.query("households").collect(),
    );
    expect(households.map((h) => h.aggregateId)).toEqual([householdId]);
    expect(households.map((h) => h.aggregateId)).not.toContain(bobHousehold);
  });

  test("switches an admin with housemates: the longest-standing member takes over", async () => {
    const t = convexTest(schema, modules);
    const { bob, dan } = await seed(t);
    const householdId = await createHousehold(t, "ann");
    const bobHousehold = await createHousehold(t, "bob");
    await invite(t, "bob", "dan", dan);
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token, true);
    expect((await requestRow(t, requestId))?.leaveConsequence).toBe("handover");

    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "joined" });
    expect(await householdOf(t, bob)).toEqual([
      { householdId, role: "member" },
    ]);
    expect(await householdOf(t, dan)).toEqual([
      { householdId: bobHousehold, role: "admin" },
    ]);
  });

  test("closes and voids when the requester's household no longer matches their consent", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    // Bob founds a household after asking without consent to leave one.
    const bobHousehold = await createHousehold(t, "bob");

    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "closed" });
    expect((await requestRow(t, requestId))?.status).toBe("void");
    expect(await householdOf(t, bob)).toEqual([
      { householdId: bobHousehold, role: "admin" },
    ]);
    expect(await myRequest(t, "bob")).toBeNull();
    expect((await landing(t, "bob", token)).joinRequest).toEqual({
      status: "closed",
    });
  });

  test("closes a lapsed request without joining", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("householdJoinRequests")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", requestId))
        .unique();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });

    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "closed" });
    expect(await householdOf(t, bob)).toEqual([]);
    expect(await myRequest(t, "bob")).toBeNull();
    expect((await mine(t, "ann"))?.joinRequests).toEqual([]);
    expect((await landing(t, "bob", token)).joinRequest).toEqual({
      status: "closed",
    });
  });

  test("refuses anyone but the household's admin", async () => {
    const t = convexTest(schema, modules);
    const { cat } = await seed(t);
    await createHousehold(t, "ann");
    await invite(t, "ann", "cat", cat);
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);

    for (const who of ["cat", "bob", "dan"] as const) {
      await expectConvexCode(approve(t, who, requestId), "NotHouseholdAdmin");
      await expectConvexCode(decline(t, who, requestId), "NotHouseholdAdmin");
    }
    expect((await requestRow(t, requestId))?.status).toBe("pending");
    // Members other than the admin never see the list.
    expect((await mine(t, "cat"))?.joinRequests).toEqual([]);
  });
});

describe("declineJoinRequest", () => {
  test("is silent: the requester keeps seeing it as waiting", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await flushScheduled(t);

    expect(await decline(t, "ann", requestId)).toBeNull();
    expect((await requestRow(t, requestId))?.status).toBe("declined");
    expect((await mine(t, "ann"))?.joinRequests).toEqual([]);
    expect((await landing(t, "bob", token)).joinRequest).toMatchObject({
      status: "pending",
      requestId,
    });
    expect((await myRequest(t, "bob"))?.requestId).toBe(requestId);
    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "closed" });

    await flushScheduled(t);
    expect(await views(t, "bob")).toEqual([]);
    const [received] = await viewsOfType(
      t,
      "ann",
      "household_join_request_received",
    );
    expect(received).toMatchObject({
      state: "resolved",
      resolvedAs: "declined",
    });
  });
});

describe("withdrawJoinRequest", () => {
  test("the requester withdraws; the admin's notification goes", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await flushScheduled(t);
    expect(
      await viewsOfType(t, "ann", "household_join_request_received"),
    ).toHaveLength(1);

    await expectConvexCode(withdraw(t, "cat", requestId), "NotRequester");
    expect(await withdraw(t, "bob", requestId)).toBeNull();
    expect((await requestRow(t, requestId))?.status).toBe("withdrawn");
    expect(
      await viewsOfType(t, "ann", "household_join_request_received"),
    ).toEqual([]);
    expect((await mine(t, "ann"))?.joinRequests).toEqual([]);
    expect(await myRequest(t, "bob")).toBeNull();
    expect(await approve(t, "ann", requestId)).toEqual({ outcome: "closed" });
  });

  test("withdrawing before dispatch leaves the admin nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await createHousehold(t, "ann");
    const token = await expiredLink(t);
    const { requestId } = await ask(t, "bob", token);
    await withdraw(t, "bob", requestId);

    await flushScheduled(t);
    expect(
      await viewsOfType(t, "ann", "household_join_request_received"),
    ).toEqual([]);
  });
});

test("unauthenticated callers are rejected", async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  await expect(
    t.mutation(api.household.requestToJoinHousehold.requestToJoinHousehold, {
      token: "x",
    }),
  ).rejects.toThrow(/Unauthenticated/);
  await expect(
    t.query(api.household.myJoinRequest.myJoinRequest, {}),
  ).rejects.toThrow(/Unauthenticated/);
  for (const fn of [
    api.household.approveJoinRequest.approveJoinRequest,
    api.household.declineJoinRequest.declineJoinRequest,
    api.household.withdrawJoinRequest.withdrawJoinRequest,
  ]) {
    await expect(t.mutation(fn, { requestId: "x" })).rejects.toThrow(
      /Unauthenticated/,
    );
  }
});
