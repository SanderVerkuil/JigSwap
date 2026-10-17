import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// social.getFollowRequesterPreview: the minimal identity the target of a PENDING follow request may
// see. Authorized only by a pending requester -> viewer request; everything else is null.

type T = TestConvex<typeof schema>;

const now = Date.now();
const requestedAt = now - 60_000;

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const viewer = await ctx.db.insert("users", {
      clerkId: "viewer",
      email: "viewer@example.com",
      name: "Viewer",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const priv = await ctx.db.insert("users", {
      clerkId: "priv",
      email: "priv@example.com",
      name: "Account Name",
      username: "priv_u",
      slug: "priv-slug",
      avatar: "https://img/priv.png",
      location: "Secret City",
      isActive: true,
      createdAt: now - 1000,
      updatedAt: now,
    });
    const other = await ctx.db.insert("users", {
      clerkId: "other",
      email: "other@example.com",
      name: "Other",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: priv,
      visibility: "private",
      displayName: "Priv Display",
      bio: "secret bio",
      updatedAt: now,
    });
    return { viewer, priv, other };
  });
  return { t, ...ids };
};

const request = (
  ctx: MutationCtx,
  requesterId: Id<"users">,
  targetId: Id<"users">,
  status: "pending" | "approved" | "declined" = "pending",
) =>
  ctx.db.insert("followRequests", {
    aggregateId: `req-${requesterId}-${targetId}`,
    requesterId,
    targetId,
    status,
    createdAt: requestedAt,
  });

const previewOf = (t: T, requesterId: Id<"users">, as = "viewer") =>
  t
    .withIdentity({ subject: as })
    .query(api.social.getFollowRequesterPreview.getFollowRequesterPreview, {
      requesterId,
    });

describe("social.getFollowRequesterPreview", () => {
  test("a pending request to the viewer returns exactly the minimal identity", async () => {
    const { t, viewer, priv } = await setup();
    await t.run((ctx) => request(ctx, priv, viewer));

    const preview = await previewOf(t, priv);
    expect(preview).toEqual({
      memberId: priv,
      displayName: "Priv Display",
      handle: "priv-slug",
      avatar: "https://img/priv.png",
      memberSince: now - 1000,
      visibility: "private",
      requestedAt,
    });
    expect(Object.keys(preview ?? {}).sort()).toEqual([
      "avatar",
      "displayName",
      "handle",
      "memberId",
      "memberSince",
      "requestedAt",
      "visibility",
    ]);
    const json = JSON.stringify(preview);
    expect(json).not.toContain("priv@example.com");
    expect(json).not.toContain("secret bio");
    expect(json).not.toContain("Secret City");
  });

  test("handle falls back to username, then the member id; no profile reads as public", async () => {
    const { t, viewer, other } = await setup();
    await t.run((ctx) => request(ctx, other, viewer));

    expect(await previewOf(t, other)).toEqual({
      memberId: other,
      displayName: "Other",
      handle: other,
      memberSince: now,
      visibility: "public",
      requestedAt,
    });
  });

  test("no request at all: null", async () => {
    const { t, priv } = await setup();
    expect(await previewOf(t, priv)).toBeNull();
  });

  test.each(["approved", "declined"] as const)(
    "a request with status %s: null",
    async (status) => {
      const { t, viewer, priv } = await setup();
      await t.run((ctx) => request(ctx, priv, viewer, status));
      expect(await previewOf(t, priv)).toBeNull();
    },
  );

  test("a request withdrawn by the requester: null", async () => {
    const { t, viewer, priv } = await setup();
    await t.run((ctx) => request(ctx, priv, viewer));
    await t
      .withIdentity({ subject: "priv" })
      .mutation(api.social.cancelFollowRequest.cancelFollowRequest, {
        requestId: `req-${priv}-${viewer}`,
      });
    expect(await previewOf(t, priv)).toBeNull();
  });

  test("a request in the opposite direction (viewer -> requester): null", async () => {
    const { t, viewer, priv } = await setup();
    await t.run((ctx) => request(ctx, viewer, priv));
    expect(await previewOf(t, priv)).toBeNull();
  });

  test("someone else's incoming request: null", async () => {
    const { t, priv, other } = await setup();
    await t.run((ctx) => request(ctx, priv, other));
    expect(await previewOf(t, priv)).toBeNull();
  });

  test("a deactivated or deleted requester: null", async () => {
    const { t, viewer, priv, other } = await setup();
    await t.run(async (ctx) => {
      await request(ctx, priv, viewer);
      await request(ctx, other, viewer);
      await ctx.db.patch(priv, { isActive: false });
      await ctx.db.delete(other);
    });
    expect(await previewOf(t, priv)).toBeNull();
    expect(await previewOf(t, other)).toBeNull();
  });

  test("unauthenticated callers are rejected", async () => {
    const { t, viewer, priv } = await setup();
    await t.run((ctx) => request(ctx, priv, viewer));
    await expect(
      t.query(api.social.getFollowRequesterPreview.getFollowRequesterPreview, {
        requesterId: priv,
      }),
    ).rejects.toThrow();
  });
});
