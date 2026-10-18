import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  MAX_HEARTBEAT_INTERVAL_MS,
  MESSAGES_ROOM,
  MIN_HEARTBEAT_INTERVAL_MS,
  presence,
} from "./presence";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const setup = () => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

const seedMember = (t: TestConvex<typeof schema>, name: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const heartbeat = (
  t: TestConvex<typeof schema>,
  name: string,
  memberId: Id<"users">,
) =>
  t
    .withIdentity({ subject: `clerk_${name}` })
    .mutation(api.presence.heartbeat, {
      roomId: MESSAGES_ROOM,
      userId: memberId as string,
      sessionId: `session-${name}`,
      interval: 30_000,
    });

describe("presence roster", () => {
  test("no member can list the room roster", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await heartbeat(t, "bob", bob);

    // The wrapper withholds the shared room token from clients.
    const returned = await heartbeat(t, "alice", alice);
    expect(returned.roomToken).toBe("");
    expect(returned.sessionToken).not.toBe("");

    // The precondition for the leak: the component itself hands out one token per room and
    // would list both members for it.
    const { roomToken } = await t.run((ctx) =>
      presence.heartbeat(ctx, MESSAGES_ROOM, alice as string, "raw", 30_000),
    );
    const raw = await t.run((ctx) => presence.list(ctx, roomToken));
    expect(raw.map((entry) => entry.userId).sort()).toEqual(
      [alice as string, bob as string].sort(),
    );

    // Even holding the real token, the public query returns nothing.
    const listed = await t
      .withIdentity({ subject: "clerk_alice" })
      .query(api.presence.list, { roomToken });
    expect(listed).toEqual([]);
  });

  test("the notification gate still sees a member on the messages page", async () => {
    const t = setup();
    const bob = await seedMember(t, "bob");
    await heartbeat(t, "bob", bob);

    const rooms = await t.run((ctx) =>
      presence.listUser(ctx, bob as string, true),
    );
    expect(rooms.map((room) => room.roomId)).toEqual([MESSAGES_ROOM]);
  });
});

describe("presence heartbeat guards", () => {
  const args = (memberId: Id<"users">) => ({
    roomId: MESSAGES_ROOM,
    userId: memberId as string,
    sessionId: "session-alice",
    interval: 30_000,
  });

  test("refuses an unauthenticated caller", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    await expect(
      t.mutation(api.presence.heartbeat, args(alice)),
    ).rejects.toThrow();
  });

  test("refuses a heartbeat on behalf of another member", async () => {
    const t = setup();
    await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await expect(
      t
        .withIdentity({ subject: "clerk_alice" })
        .mutation(api.presence.heartbeat, args(bob)),
    ).rejects.toThrow(/Presence user mismatch/);
  });

  test("refuses any room other than messages", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    await expect(
      t
        .withIdentity({ subject: "clerk_alice" })
        .mutation(api.presence.heartbeat, { ...args(alice), roomId: "other" }),
    ).rejects.toThrow(/Unknown presence room/);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 4_999, 60_001])(
    "refuses interval %s",
    async (interval) => {
      const t = setup();
      const alice = await seedMember(t, "alice");
      await expect(
        t
          .withIdentity({ subject: "clerk_alice" })
          .mutation(api.presence.heartbeat, { ...args(alice), interval }),
      ).rejects.toThrow(/Invalid presence interval/);
    },
  );

  test.each(["", "x".repeat(201)])(
    "refuses a session id of length %#",
    async (sessionId) => {
      const t = setup();
      const alice = await seedMember(t, "alice");
      await expect(
        t
          .withIdentity({ subject: "clerk_alice" })
          .mutation(api.presence.heartbeat, { ...args(alice), sessionId }),
      ).rejects.toThrow(/Invalid presence session/);
    },
  );

  test("accepts the bounds", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const asAlice = t.withIdentity({ subject: "clerk_alice" });
    await asAlice.mutation(api.presence.heartbeat, {
      ...args(alice),
      interval: MIN_HEARTBEAT_INTERVAL_MS,
    });
    await asAlice.mutation(api.presence.heartbeat, {
      ...args(alice),
      interval: MAX_HEARTBEAT_INTERVAL_MS,
    });
  });
});
