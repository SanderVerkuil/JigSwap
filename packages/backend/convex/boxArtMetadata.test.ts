import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  findMetadata,
  orientationOnlyApp1,
} from "./lib/imageModeration/stripMetadata";
import schema from "./schema";

// Box art never keeps the uploader's metadata: an upload goes through catalog/sanitizeBoxArt
// (byte-level strip, new blob, upload deleted), a fetched shop image through importPuzzleImage
// (same strip), and the catalog mutations only take a NEW image that the server cleaned for the
// acting member. Fixtures: see stripMetadata.test.ts.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );
const SECRETS = ["Kerkstraat", "Utrecht", "FixtureCam", "52,5.2057N"];
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice"),
      bob: await mkUser("clerk_bob"),
    };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

const upload = (
  t: TestConvex<typeof schema>,
  bytes: Uint8Array | string,
  type: string,
) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type })),
  ) as Promise<Id<"_storage">>;

const stored = async (t: TestConvex<typeof schema>, id: Id<"_storage">) => {
  const blob = await t.run(async (ctx) => {
    const found = await ctx.storage.get(id);
    return found
      ? { buffer: await found.arrayBuffer(), type: found.type }
      : null;
  });
  return blob && { bytes: new Uint8Array(blob.buffer), type: blob.type };
};

const errorData = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data : String(error);
  }
  throw new Error("expected a refusal");
};

const sanitize = (t: TestConvex<typeof schema>, storageId: Id<"_storage">) =>
  asAlice(t).action(api.catalog.sanitizeBoxArt.sanitizeBoxArt, { storageId });

describe("sanitizeBoxArt", () => {
  test.each([
    ["JPEG", "gps.jpg", "image/jpeg", "jpeg"],
    ["PNG", "gps.png", "image/png", "png"],
    ["WebP", "gps.webp", "image/webp", "webp"],
  ] as const)(
    "a %s with GPS is stored without metadata, listed for the member, and the upload deleted",
    async (_name, file, type, format) => {
      const t = convexTest(schema, modules);
      const { alice } = await seed(t);
      const uploadId = await upload(t, fixture(file), type);

      const cleanId = await sanitize(t, uploadId);

      expect(cleanId).not.toBe(uploadId);
      expect(await stored(t, uploadId)).toBeNull();
      const clean = (await stored(t, cleanId))!;
      expect(clean.type).toBe(type);
      expect(findMetadata(clean.bytes, format)).toEqual([]);
      for (const secret of SECRETS) {
        expect(latin1(clean.bytes)).not.toContain(secret);
      }
      const rows = await t.run((ctx) =>
        ctx.db.query("boxArtUploads").collect(),
      );
      expect(rows).toMatchObject([{ storageId: cleanId, uploaderId: alice }]);
    },
  );

  test("a JPEG keeps only its Orientation, so it still shows upright", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const cleanId = await sanitize(
      t,
      await upload(t, fixture("gps.jpg"), "image/jpeg"),
    );
    const clean = (await stored(t, cleanId))!;
    expect(latin1(clean.bytes)).toContain(latin1(orientationOnlyApp1(6)));
  });

  test.each([
    [
      "an SVG",
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      "image/svg+xml",
      "unsupported_format",
    ],
    [
      "HTML named a JPEG",
      "<!DOCTYPE html><html></html>",
      "image/jpeg",
      "unsupported_format",
    ],
    [
      "a GIF",
      "GIF89a\x01\x00\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;",
      "image/gif",
      "unsupported_format",
    ],
    [
      "a truncated JPEG",
      fixture("gps.jpg").subarray(0, 3300),
      "image/jpeg",
      "malformed",
    ],
  ] as const)(
    "%s is refused and the upload deleted",
    async (_name, bytes, type, reason) => {
      const t = convexTest(schema, modules);
      await seed(t);
      const uploadId = await upload(t, bytes, type);

      expect(await errorData(sanitize(t, uploadId))).toMatchObject({
        code: "InvalidImage",
        reason,
      });
      expect(await stored(t, uploadId)).toBeNull();
      expect(
        await t.run((ctx) => ctx.db.query("boxArtUploads").collect()),
      ).toEqual([]);
    },
  );

  test("a blob something already uses (e.g. another member's box art) is never read or deleted", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const bobsArt = await upload(t, fixture("gps.jpg"), "image/jpeg");
    await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: "Bob's",
        pieceCount: 500,
        status: "approved",
        submittedBy: bob,
        image: bobsArt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    expect(await errorData(sanitize(t, bobsArt))).toMatchObject({
      code: "InvalidUpload",
    });
    expect(await stored(t, bobsArt)).not.toBeNull();
  });

  test("signed-out callers are refused", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const uploadId = await upload(t, fixture("gps.jpg"), "image/jpeg");
    await expect(
      t.action(api.catalog.sanitizeBoxArt.sanitizeBoxArt, {
        storageId: uploadId,
      }),
    ).rejects.toThrow();
    expect(await stored(t, uploadId)).not.toBeNull();
  });
});

describe("importPuzzleImage", () => {
  test("a shop image is stored stripped and listed for the member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(fixture("gps.jpg") as BodyInit, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    );
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);

    const id = await asAlice(t).action(
      api.catalog.importPuzzleImage.importPuzzleImage,
      { url: "https://shop.example/box.jpg" },
    );

    const clean = (await stored(t, id))!;
    expect(clean.type).toBe("image/jpeg");
    expect(findMetadata(clean.bytes, "jpeg")).toEqual([]);
    for (const secret of SECRETS) {
      expect(latin1(clean.bytes)).not.toContain(secret);
    }
    const rows = await t.run((ctx) => ctx.db.query("boxArtUploads").collect());
    expect(rows).toMatchObject([{ storageId: id, uploaderId: alice }]);
  });

  test("an SVG served as an image is refused and nothing is stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asAlice(t).action(api.catalog.importPuzzleImage.importPuzzleImage, {
        url: "https://shop.example/box.png",
      }),
    ).rejects.toThrow(/Unsupported image type/);
    expect(
      await t.run((ctx) => ctx.db.query("boxArtUploads").collect()),
    ).toEqual([]);
  });
});

describe("catalog mutations take only cleaned box art", () => {
  const submit = (
    t: TestConvex<typeof schema>,
    as: typeof asAlice,
    image?: string,
  ) =>
    as(t).mutation(api.catalog.submitPuzzleDefinition.submitPuzzleDefinition, {
      title: "Mountain Vista",
      pieceCount: 1000,
      image,
    });

  test("a raw upload is refused; the cleaned one is accepted", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const raw = await upload(t, fixture("gps.jpg"), "image/jpeg");

    expect(await errorData(submit(t, asAlice, raw))).toMatchObject({
      code: "InvalidImage",
    });

    const clean = await sanitize(t, raw);
    const id = await submit(t, asAlice, clean);
    const row = await t.run((ctx) =>
      ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
        .unique(),
    );
    expect(row?.image).toBe(clean);
  });

  test("box art cleaned for another member is refused", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const clean = await sanitize(
      t,
      await upload(t, fixture("gps.jpg"), "image/jpeg"),
    );
    expect(await errorData(submit(t, asBob, clean))).toMatchObject({
      code: "InvalidImage",
    });
  });

  test("a garbage id is refused, not a crash", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await errorData(submit(t, asAlice, "not-a-storage-id")),
    ).toMatchObject({
      code: "InvalidImage",
    });
  });

  test("update, propose and edit-proposal: the current image may be restated, a raw upload may not", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    // A definition whose box art predates the strip (never listed in boxArtUploads).
    const legacyArt = await upload(t, fixture("gps.png"), "image/png");
    const definitionId = crypto.randomUUID();
    await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        aggregateId: definitionId,
        title: "Legacy",
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        image: legacyArt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const raw = await upload(t, fixture("gps.jpg"), "image/jpeg");

    await asAlice(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, title: "Legacy 2", image: legacyArt },
    );
    expect(
      await errorData(
        asAdmin(t).mutation(
          api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
          { puzzleDefinitionId: definitionId, image: raw },
        ),
      ),
    ).toMatchObject({ code: "InvalidImage" });
    expect(
      await errorData(
        asBob(t).mutation(
          api.catalog.proposeDefinitionChange.proposeDefinitionChange,
          { puzzleDefinitionId: definitionId, image: raw },
        ),
      ),
    ).toMatchObject({ code: "InvalidImage" });

    const bobsClean = await asBob(t).action(
      api.catalog.sanitizeBoxArt.sanitizeBoxArt,
      { storageId: raw },
    );
    const proposalId = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, image: bobsClean },
    );
    // The edit form restates the proposal's image alongside the edited fields.
    await asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
      changeProposalId: proposalId as string,
      title: "Legacy (2nd ed.)",
      image: bobsClean,
    });
    const other = await upload(t, fixture("gps.webp"), "image/webp");
    expect(
      await errorData(
        asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
          changeProposalId: proposalId as string,
          image: other,
        }),
      ),
    ).toMatchObject({ code: "InvalidImage" });
  });
});
