import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { fetchPublic } from "./catalog/adapters/publicFetch";
import schema from "./schema";

// catalog/importPuzzleImage fetches a shop image through the SSRF-safe transport
// (catalog/adapters/publicFetch, covered by publicFetch.test.ts; faked here through a stubbed
// global fetch). These cover what the action makes of the answer: a refused host or a failed fetch
// tells the caller nothing about the remote side, and an oversized body is not read past the cap.
// Storing and checking the image is covered in boxArtMetadata.test.ts and boxArtModeration.test.ts.

vi.mock("./catalog/adapters/publicFetch", async (importOriginal) =>
  (
    await import("../test-fixtures/publicFetchViaGlobalFetch")
  ).publicFetchViaGlobalFetch(importOriginal),
);

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const MB = 1024 * 1024;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "none");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "clerk_alice@example.com",
      name: "clerk_alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  return t;
};

const importImage = (t: TestConvex<typeof schema>, url: string) =>
  t
    .withIdentity({ subject: "clerk_alice" })
    .action(api.catalog.importPuzzleImage.importPuzzleImage, { url });

const errorData = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data : String(error);
  }
  throw new Error("expected a refusal");
};

const storedBlobs = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.system.query("_storage").collect());

describe("importPuzzleImage fetch outcomes", () => {
  test("a failed fetch is reported without the remote status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );
    const t = await setup();

    expect(
      await errorData(importImage(t, "https://shop.example/missing.jpg")),
    ).toBe("Image fetch failed");
    // The status is for the server log only.
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toContain(
      "404",
    );
    expect(await storedBlobs(t)).toEqual([]);
  });

  test("a host the transport refuses is reported as blocked and never fetched", async () => {
    const network = vi.fn(async () => new Response("secret"));
    vi.stubGlobal("fetch", network);
    vi.mocked(fetchPublic).mockResolvedValueOnce({
      ok: false,
      code: "Blocked",
      detail: "Refused to fetch (blocked address): internal.example",
    });
    const t = await setup();

    expect(
      await errorData(importImage(t, "https://internal.example/box.jpg")),
    ).toBe("Refused to fetch image (blocked address)");
    expect(network).not.toHaveBeenCalled();
    expect(await storedBlobs(t)).toEqual([]);
  });

  test("an image over 10 MB is refused without reading the rest", async () => {
    // A 25 MB body without a content-length, produced only as fast as it is read.
    const CHUNK = 64 * 1024;
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 25 * MB) {
          controller.close();
          return;
        }
        produced += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const t = await setup();

    expect(
      await errorData(importImage(t, "https://shop.example/huge.jpg")),
    ).toBe("Image too large");
    expect(produced).toBeLessThanOrEqual(10 * MB + 2 * CHUNK);
    expect(await storedBlobs(t)).toEqual([]);
  });
});
