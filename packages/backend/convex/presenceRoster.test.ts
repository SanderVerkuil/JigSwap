import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MESSAGES_ROOM, presence } from "./presence";
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
  test("the shared room token never lists other members", async () => {
    const t = setup();
    const alice = await seedMember(t, "alice");
    const bob = await seedMember(t, "bob");
    await heartbeat(t, "bob", bob);
    const { roomToken } = await heartbeat(t, "alice", alice);

    // The precondition for the leak: the component itself would list both members
    // for the token every heartbeating member receives.
    const raw = await t.run((ctx) => presence.list(ctx, roomToken));
    expect(raw.map((entry) => entry.userId).sort()).toEqual(
      [alice as string, bob as string].sort(),
    );

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
