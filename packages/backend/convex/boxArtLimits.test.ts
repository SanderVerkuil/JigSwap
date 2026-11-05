import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Every box-art check (catalog/sanitizeBoxArt for an upload, catalog/importPuzzleImage for a shop
// image) runs the paid moderation pipeline inline, and the import also fetches a remote image
// first. Each member has an hourly and a daily box-art bucket (RATE_LIMITS.boxArtCheck 20,
// boxArtCheckDaily 60), charged before the upload is claimed or anything is fetched (SEC-19).
// Admins, who seed the catalogue, are exempt.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Classification off (approves unchecked), hash check off: this file is about the limit.
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "none");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jpeg = () =>
  new Uint8Array(
    readFileSync(new URL("../test-fixtures/images/gps.jpg", import.meta.url)),
  );

const seedMember = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const asMember = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });
const asAdmin = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId, metadata: { role: "admin" } });

const seedBucket = (t: TestConvex<typeof schema>, key: string, count: number) =>
  t.run((ctx) =>
    ctx.db.insert("rateLimits", { key, windowStart: Date.now(), count }),
  );

const buckets = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("rateLimits").collect()).map((row) => [
        row.key,
        row.count,
      ]),
    ),
  );

const upload = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([jpeg() as BlobPart], { type: "image/jpeg" })),
  ) as Promise<Id<"_storage">>;

const boxArtRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("boxArtUploads").collect());
const blobCount = (t: TestConvex<typeof schema>) =>
  t.run(
    async (ctx) => (await ctx.db.system.query("_storage").collect()).length,
  );

// A shop that serves the fixture JPEG for every image fetch.
const stubShop = () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(jpeg() as BodyInit, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// convex-test may hand ConvexError.data over as a JSON string; normalise.
const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    const data = (error as ConvexError<Value>).data;
    return (typeof data === "string" ? JSON.parse(data) : data) as {
      code?: string;
      retryAfterMs?: number;
    };
  }
  throw new Error("expected a refusal");
};

describe("sanitizeBoxArt: per-member limit", () => {
  test("each check is charged to the member's hourly and daily buckets", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");

    await asMember(t, "clerk_alice").action(
      api.catalog.sanitizeBoxArt.sanitizeBoxArt,
      { storageId: await upload(t) },
    );

    expect(await buckets(t)).toEqual({
      [`boxArtCheck:${alice}`]: 1,
      [`boxArtCheckDaily:${alice}`]: 1,
    });
  });

  test("the 21st check in an hour is refused before the upload is claimed or checked", async () => {
    const fetchMock = stubShop();
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");
    await seedBucket(t, `boxArtCheck:${alice}`, 20);
    const storageId = await upload(t);

    const refusal = await refusalOf(
      asMember(t, "clerk_alice").action(
        api.catalog.sanitizeBoxArt.sanitizeBoxArt,
        { storageId },
      ),
    );

    expect(refusal.code).toBe("RateLimited");
    expect(refusal.retryAfterMs).toBeGreaterThan(0);
    expect(await boxArtRows(t)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await buckets(t)).toEqual({ [`boxArtCheck:${alice}`]: 20 });
  });

  test("the daily bucket holds a member to 60 checks a day", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");
    await seedBucket(t, `boxArtCheckDaily:${alice}`, 60);

    expect(
      (
        await refusalOf(
          asMember(t, "clerk_alice").action(
            api.catalog.sanitizeBoxArt.sanitizeBoxArt,
            { storageId: await upload(t) },
          ),
        )
      ).code,
    ).toBe("RateLimited");
    expect(await boxArtRows(t)).toEqual([]);
  });

  test("a caller without a member row is refused before anything is claimed", async () => {
    const t = convexTest(schema, modules);

    await expect(
      asMember(t, "clerk_nobody").action(
        api.catalog.sanitizeBoxArt.sanitizeBoxArt,
        { storageId: await upload(t) },
      ),
    ).rejects.toThrow(/Member not found/);
    expect(await boxArtRows(t)).toEqual([]);
    expect(await buckets(t)).toEqual({});
  });

  test("admins are not held to the limit", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedMember(t, "clerk_admin");
    await seedBucket(t, `boxArtCheck:${admin}`, 20);
    await seedBucket(t, `boxArtCheckDaily:${admin}`, 60);

    const clean = await asAdmin(t, "clerk_admin").action(
      api.catalog.sanitizeBoxArt.sanitizeBoxArt,
      { storageId: await upload(t) },
    );

    expect(await boxArtRows(t)).toMatchObject([
      { storageId: clean, uploaderId: admin },
    ]);
  });
});

describe("importPuzzleImage: per-member limit", () => {
  test("a member past the hourly bucket is refused before the image is fetched", async () => {
    const fetchMock = stubShop();
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");
    await seedBucket(t, `boxArtCheck:${alice}`, 20);

    expect(
      (
        await refusalOf(
          asMember(t, "clerk_alice").action(
            api.catalog.importPuzzleImage.importPuzzleImage,
            { url: "https://shop.example/box.jpg" },
          ),
        )
      ).code,
    ).toBe("RateLimited");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobCount(t)).toBe(0);
    expect(await boxArtRows(t)).toEqual([]);
  });

  test("an import within the limit is charged once", async () => {
    stubShop();
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");

    await asMember(t, "clerk_alice").action(
      api.catalog.importPuzzleImage.importPuzzleImage,
      { url: "https://shop.example/box.jpg" },
    );

    expect(await buckets(t)).toEqual({
      [`boxArtCheck:${alice}`]: 1,
      [`boxArtCheckDaily:${alice}`]: 1,
    });
  });

  test("admins are not held to the limit", async () => {
    const fetchMock = stubShop();
    const t = convexTest(schema, modules);
    const admin = await seedMember(t, "clerk_admin");
    await seedBucket(t, `boxArtCheck:${admin}`, 20);

    await asAdmin(t, "clerk_admin").action(
      api.catalog.importPuzzleImage.importPuzzleImage,
      { url: "https://shop.example/box.jpg" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await boxArtRows(t)).toHaveLength(1);
  });
});
