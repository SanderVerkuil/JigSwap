import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// The box-art publication gate (lib/imageModeration/boxArtUrl): box art listed in boxArtUploads
// is served only once "approved" with its CSAM hash check passed; legacy box art (no row, or a
// row from before box art was moderated) is served as before.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type Listing = Partial<
  Pick<
    Doc<"boxArtUploads">,
    "moderationStatus" | "hashCheckedAt" | "hashCheckPendingSince"
  >
>;

// An approved definition whose box art is listed with `listing` (or not listed at all).
const seedDefinition = async (
  t: TestConvex<typeof schema>,
  listing: Listing | null,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const image = await ctx.storage.store(
      new Blob(["art"], { type: "image/jpeg" }),
    );
    if (listing) {
      await ctx.db.insert("boxArtUploads", {
        storageId: image,
        uploaderId: alice,
        createdAt: now,
        ...listing,
      });
    }
    return ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      image,
      createdAt: now,
      updatedAt: now,
    });
  });

const imageOf = async (t: TestConvex<typeof schema>, puzzleId: Id<"puzzles">) =>
  (await t.query(api.catalog.getPuzzleById.getPuzzleById, { puzzleId }))
    ?.image ?? null;

describe("box-art publication gate", () => {
  test.each([
    ["not listed (legacy)", null],
    ["listed before box art was moderated", {}],
    [
      "approved, hash check passed",
      { moderationStatus: "approved", hashCheckedAt: 1 },
    ],
  ] as const)("served: %s", async (_name, listing) => {
    const t = convexTest(schema, modules);
    const puzzleId = await seedDefinition(t, listing);
    expect(await imageOf(t, puzzleId)).toMatch(/^https?:\/\//);
  });

  test.each([
    ["pending", { moderationStatus: "pending", hashCheckPendingSince: 1 }],
    [
      "approved but the hash check still waiting",
      { moderationStatus: "approved", hashCheckPendingSince: 1 },
    ],
    ["unscored", { moderationStatus: "unscored", hashCheckedAt: 1 }],
    ["rejected", { moderationStatus: "rejected", hashCheckedAt: 1 }],
    [
      "quarantined",
      { moderationStatus: "quarantined", hashCheckPendingSince: 1 },
    ],
  ] as const)("not served: %s", async (_name, listing) => {
    const t = convexTest(schema, modules);
    const puzzleId = await seedDefinition(t, listing);
    expect(await imageOf(t, puzzleId)).toBeNull();
  });

  // Every read path must go through boxArtUrl: no module turns a `.image` into a URL itself.
  test("no read path resolves box art with ctx.storage.getUrl directly", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "_generated" || name === "node_modules") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
          const source = readFileSync(path, "utf8");
          if (/getUrl\(\s*[\w?.]*\.image\b/.test(source)) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
