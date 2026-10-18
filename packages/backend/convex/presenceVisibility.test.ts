import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  APP_AWAY_ROOM,
  APP_ONLINE_ROOM,
  MESSAGES_ROOM,
  presence,
} from "./presence";
import schema from "./schema";

// Presence visibility (spec 5.1): getPresenceOf shows a member as online/away only to a mutual
// follower, both sharing, not blocked either way, target not invisible. Everything else is absent.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const setup = () => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

const as = (t: T, name: string) => t.withIdentity({ subject: `clerk_${name}` });

const seedMember = (t: T, name: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 }),
  );

const mutual = async (t: T, a: Id<"users">, b: Id<"users">) => {
  await follow(t, a, b);
  await follow(t, b, a);
};

const share = (t: T, name: string, value = true) =>
  as(t, name).mutation(
    api.social.setPresencePreferences.setPresencePreferences,
    {
      share: value,
    },
  );

const heartbeat = (t: T, name: string, memberId: Id<"users">, roomId: string) =>
  as(t, name).mutation(api.presence.heartbeat, {
    roomId,
    userId: memberId as string,
    sessionId: `session-${name}-${roomId}`,
    interval: 30_000,
  });

const presenceOf = (t: T, name: string, memberIds: Id<"users">[]) =>
  as(t, name).query(api.social.getPresenceOf.getPresenceOf, { memberIds });

// Alice (viewer) and Bob (target): mutual followers, both sharing, Bob active.
const seed = async () => {
  const t = setup();
  const alice = await seedMember(t, "alice");
  const bob = await seedMember(t, "bob");
  await mutual(t, alice, bob);
  await share(t, "alice");
  await share(t, "bob");
  await heartbeat(t, "bob", bob, APP_ONLINE_ROOM);
  return { t, alice, bob };
};

describe("getPresenceOf", () => {
  test("a sharing mutual follower who is active reads online", async () => {
    const { t, bob } = await seed();
    expect(await presenceOf(t, "alice", [bob])).toEqual([
      { memberId: bob, status: "online" },
    ]);
  });

  test("an idle member (app:away only) reads away", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await mutual(t, alice, bob);
    await share(t, "alice");
    await share(t, "bob");
    await heartbeat(t, "bob", bob, APP_AWAY_ROOM);
    expect(await presenceOf(t, "alice", [bob])).toEqual([
      { memberId: bob, status: "away" },
    ]);
  });

  test("the away override reads away while active", async () => {
    const { t, bob } = await seed();
    await as(t, "bob").mutation(
      api.social.setPresencePreferences.setPresencePreferences,
      { override: "away" },
    );
    expect(await presenceOf(t, "alice", [bob])).toEqual([
      { memberId: bob, status: "away" },
    ]);
  });

  test("being only on /messages is not app presence", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await mutual(t, alice, bob);
    await share(t, "alice");
    await share(t, "bob");
    await heartbeat(t, "bob", bob, MESSAGES_ROOM);
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("an offline member is absent", async () => {
    const { t, bob } = await seed();
    await t.run((ctx) =>
      presence.removeRoomUser(ctx, APP_ONLINE_ROOM, bob as string),
    );
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a deactivated (tombstoned) member is absent", async () => {
    const { t, bob } = await seed();
    await t.run((ctx) => ctx.db.patch(bob, { isActive: false }));
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a deleted member is absent, even with rows left behind", async () => {
    const { t, bob } = await seed();
    // Follows, settings and the component's online row all remain; only the user row is gone.
    await t.run((ctx) => ctx.db.delete(bob));
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a non-mutual follower sees nothing, even of a public profile", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await follow(t, alice, bob); // one way only
    await share(t, "alice");
    await share(t, "bob");
    await heartbeat(t, "bob", bob, APP_ONLINE_ROOM);
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a private profile is visible to a mutual follower", async () => {
    const { t, bob } = await seed();
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId: bob,
        visibility: "private",
        updatedAt: 1,
      }),
    );
    expect(await presenceOf(t, "alice", [bob])).toEqual([
      { memberId: bob, status: "online" },
    ]);
  });

  test.each(["viewer", "target"] as const)(
    "a block placed by the %s hides presence",
    async (blocker) => {
      const { t, alice, bob } = await seed();
      await t.run((ctx) =>
        ctx.db.insert("blocks", {
          blockerId: blocker === "viewer" ? alice : bob,
          blockedId: blocker === "viewer" ? bob : alice,
          createdAt: 1,
        }),
      );
      expect(await presenceOf(t, "alice", [bob])).toEqual([]);
    },
  );

  test("an invisible target is absent", async () => {
    const { t, bob } = await seed();
    await as(t, "bob").mutation(
      api.social.setPresencePreferences.setPresencePreferences,
      { override: "invisible" },
    );
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a target who stopped sharing is absent", async () => {
    const { t, bob } = await seed();
    await share(t, "bob", false);
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a target who never chose to share is absent", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await mutual(t, alice, bob);
    await share(t, "alice");
    await heartbeat(t, "bob", bob, APP_ONLINE_ROOM);
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("a viewer who doesn't share sees nobody (reciprocity)", async () => {
    const { t, bob } = await seed();
    await share(t, "alice", false);
    expect(await presenceOf(t, "alice", [bob])).toEqual([]);
  });

  test("the viewer is never in their own result", async () => {
    const { t, alice, bob } = await seed();
    await heartbeat(t, "alice", alice, APP_ONLINE_ROOM);
    expect(await presenceOf(t, "alice", [alice, bob])).toEqual([
      { memberId: bob, status: "online" },
    ]);
  });

  test("duplicate ids are answered once", async () => {
    const { t, bob } = await seed();
    expect(await presenceOf(t, "alice", [bob, bob])).toEqual([
      { memberId: bob, status: "online" },
    ]);
  });

  test("rejects more than 50 ids", async () => {
    const { t, bob } = await seed();
    await expect(
      presenceOf(
        t,
        "alice",
        Array.from({ length: 51 }, () => bob),
      ),
    ).rejects.toThrow(/TooManyMembers/);
    expect(
      await presenceOf(
        t,
        "alice",
        Array.from({ length: 50 }, () => bob),
      ),
    ).toHaveLength(1);
  });

  test("refuses an unauthenticated caller", async () => {
    const { t, bob } = await seed();
    await expect(
      t.query(api.social.getPresenceOf.getPresenceOf, { memberIds: [bob] }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("exposes nothing but the member id and status", async () => {
    const { t, bob } = await seed();
    const [view] = await presenceOf(t, "alice", [bob]);
    expect(Object.keys(view ?? {}).sort()).toEqual(["memberId", "status"]);
  });
});

describe("presence settings", () => {
  test("default: never asked, automatic", async () => {
    const t = setup();
    await seedMember(t, "alice");
    expect(
      await as(t, "alice").query(
        api.social.getMyPresenceSettings.getMyPresenceSettings,
        {},
      ),
    ).toEqual({ share: null, override: "auto" });
  });

  test("each field is updated independently on the member's own row", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    await seedMember(t, "bob");
    const set = api.social.setPresencePreferences.setPresencePreferences;
    const get = api.social.getMyPresenceSettings.getMyPresenceSettings;
    await as(t, "alice").mutation(set, { override: "invisible" });
    expect(await as(t, "alice").query(get, {})).toEqual({
      share: null,
      override: "invisible",
    });
    await as(t, "alice").mutation(set, { share: true });
    expect(await as(t, "alice").query(get, {})).toEqual({
      share: true,
      override: "invisible",
    });
    expect(await as(t, "bob").query(get, {})).toEqual({
      share: null,
      override: "auto",
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("presencePreferences").collect(),
    );
    expect(rows.map((row) => row.memberId)).toEqual([alice]);
  });

  test("refuses an unauthenticated caller", async () => {
    const t = setup();
    await expect(
      t.mutation(api.social.setPresencePreferences.setPresencePreferences, {
        share: true,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

describe("presence heartbeat rooms", () => {
  test.each([MESSAGES_ROOM, APP_ONLINE_ROOM, APP_AWAY_ROOM])(
    "accepts %s",
    async (roomId) => {
      const t = setup();
      const alice = await seedMember(t, "alice");
      await heartbeat(t, "alice", alice, roomId);
    },
  );

  test("still refuses an unknown room", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    await expect(heartbeat(t, "alice", alice, "app:busy")).rejects.toThrow(
      /Unknown presence room/,
    );
  });

  test("logs a bandwidth counter without member or session ids", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await heartbeat(t, "alice", alice, APP_ONLINE_ROOM);
    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"presence.heartbeat"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "presence.heartbeat",
      room: APP_ONLINE_ROOM,
    });
    expect(lines[0]).not.toContain(alice as string);
    expect(lines[0]).not.toContain("session-");
  });
});

describe("account deletion", () => {
  test("purges presence settings and every component presence row", async () => {
    const { t, alice, bob } = await seed();
    await heartbeat(t, "bob", bob, APP_AWAY_ROOM);
    // An offline row (the component keeps its lastDisconnected) must go too.
    const { sessionToken } = await heartbeat(t, "bob", bob, MESSAGES_ROOM);
    await t.mutation(api.presence.disconnect, { sessionToken });
    const before = await t.run((ctx) =>
      presence.listUser(ctx, bob as string, false),
    );
    expect(before.map((room) => [room.roomId, room.online]).sort()).toEqual([
      [APP_AWAY_ROOM, true],
      [APP_ONLINE_ROOM, true],
      [MESSAGES_ROOM, false],
    ]);
    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: bob, phase: "presence" },
    );
    const left = await t.run(async (ctx) => ({
      prefs: (await ctx.db.query("presencePreferences").collect()).map(
        (row) => row.memberId,
      ),
      bobRooms: await presence.listUser(ctx, bob as string, false),
    }));
    expect(left).toEqual({ prefs: [alice], bobRooms: [] });
  });
});
