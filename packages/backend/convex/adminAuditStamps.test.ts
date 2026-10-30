import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Audit trail for the admin writes that used to leave none (review 2026-10-29, SEC-56): an admin
// re-checking an unscored photo, managing the catalogue categories, or marking a contact message
// handled stamps exactly one `moderationActions` row with the acting admin. A no-op stamps
// nothing, and no label carries a contact sender's name or email.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("HF_MODERATION_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asMember = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

const seedUsers = (t: TestConvex<typeof schema>) =>
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
      admin: await mkUser("clerk_admin"),
    };
  });

type Stamp = Pick<
  Doc<"moderationActions">,
  "actorId" | "kind" | "targetLabel" | "targetId"
>;

const stamps = async (t: TestConvex<typeof schema>): Promise<Stamp[]> =>
  (await t.run((ctx) => ctx.db.query("moderationActions").collect())).map(
    ({ actorId, kind, targetLabel, targetId }) => ({
      actorId,
      kind,
      targetLabel,
      targetId,
    }),
  );

describe("admin/recheckPhoto", () => {
  // Hold the scheduled check so the row stays as the mutation left it.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const seedPhotos = (t: TestConvex<typeof schema>, alice: Id<"users">) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Mountain Vista",
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        createdAt: now,
        updatedAt: now,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: alice,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        snapshot: { title: "Mountain Vista", pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
      });
      const copyPhoto = async (status: "unscored" | "pending") =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId: alice,
          fileId: await ctx.storage.store(new Blob(["x"])),
          moderationStatus: status,
          createdAt: now,
          updatedAt: now,
        });
      const completionId = crypto.randomUUID();
      const completionFile = await ctx.storage.store(new Blob(["y"]));
      await ctx.db.insert("completions", {
        aggregateId: completionId,
        userId: alice,
        startDate: now - 2000,
        endDate: now - 1000,
        photos: [completionFile],
        isCompleted: true,
        copySnapshot: {
          copyId: crypto.randomUUID(),
          ownerId: alice,
          wasBorrowed: false,
          condition: "good",
          title: "Ocean Sunset",
          pieceCount: 500,
        },
        createdAt: now,
        updatedAt: now,
      });
      return {
        unscoredCopy: await copyPhoto("unscored"),
        pendingCopy: await copyPhoto("pending"),
        unscoredCompletion: await ctx.db.insert("completionImages", {
          completionId,
          uploaderId: alice,
          fileId: completionFile,
          moderationStatus: "unscored",
          createdAt: now,
          updatedAt: now,
        }),
      };
    });

  test("re-checking an unscored photo stamps photo_recheck_requested with its title", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, admin } = await seedUsers(t);
    const { unscoredCopy, unscoredCompletion } = await seedPhotos(t, alice);

    await asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source: "copy",
      imageId: unscoredCopy,
    });
    await asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source: "completion",
      imageId: unscoredCompletion,
    });

    expect(await stamps(t)).toEqual([
      {
        actorId: admin,
        kind: "photo_recheck_requested",
        targetLabel: "Mountain Vista",
        targetId: unscoredCopy,
      },
      {
        actorId: admin,
        kind: "photo_recheck_requested",
        targetLabel: "Ocean Sunset",
        targetId: unscoredCompletion,
      },
    ]);
  });

  test("a no-op (still pending), a refused or a non-admin re-check stamps nothing", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice } = await seedUsers(t);
    const { unscoredCopy, pendingCopy } = await seedPhotos(t, alice);

    await asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source: "copy",
      imageId: pendingCopy,
    });
    await t.run((ctx) =>
      ctx.db.patch(unscoredCopy, { moderationStatus: "approved" }),
    );
    await expect(
      asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "copy",
        imageId: unscoredCopy,
      }),
    ).rejects.toThrow("Only unchecked photos can be checked again");
    await expect(
      asMember(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "copy",
        imageId: pendingCopy,
      }),
    ).rejects.toThrow("Forbidden");

    expect(await stamps(t)).toEqual([]);
  });
});

describe("catalogue categories", () => {
  const create = (t: TestConvex<typeof schema>, en: string, sortOrder = 1) =>
    asAdmin(t).mutation(
      api.catalog.createCatalogCategory.createCatalogCategory,
      {
        name: { en, nl: `${en} (nl)` },
        sortOrder,
      },
    );

  test("create and update each stamp once with the English name", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedUsers(t);
    const id = await create(t, "Animals");
    await asAdmin(t).mutation(
      api.catalog.updateCatalogCategory.updateCatalogCategory,
      { catalogCategoryId: id, name: { en: "Wildlife", nl: "Wilde dieren" } },
    );
    // An update that leaves the name alone is labelled with the current name.
    await asAdmin(t).mutation(
      api.catalog.updateCatalogCategory.updateCatalogCategory,
      { catalogCategoryId: id, color: "#7c3aed" },
    );

    expect(await stamps(t)).toEqual([
      {
        actorId: admin,
        kind: "category_created",
        targetLabel: "Animals",
        targetId: id,
      },
      {
        actorId: admin,
        kind: "category_updated",
        targetLabel: "Wildlife",
        targetId: id,
      },
      {
        actorId: admin,
        kind: "category_updated",
        targetLabel: "Wildlife",
        targetId: id,
      },
    ]);
  });

  test("(de)activation stamps only when the state changes", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedUsers(t);
    const id = await create(t, "Animals");
    const setActive = (isActive: boolean) =>
      asAdmin(t).mutation(
        api.catalog.setCatalogCategoryActive.setCatalogCategoryActive,
        { catalogCategoryId: id, isActive },
      );

    await setActive(true); // already active: no-op
    await setActive(false);
    await setActive(false); // already inactive: no-op
    await setActive(true);

    expect((await stamps(t)).slice(1)).toEqual([
      {
        actorId: admin,
        kind: "category_deactivated",
        targetLabel: "Animals",
        targetId: id,
      },
      {
        actorId: admin,
        kind: "category_reactivated",
        targetLabel: "Animals",
        targetId: id,
      },
    ]);
  });

  test("a reorder stamps once, however many nodes move", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedUsers(t);
    const a = await create(t, "A", 1);
    const b = await create(t, "B", 2);
    await asAdmin(t).mutation(
      api.catalog.reorderCatalogCategories.reorderCatalogCategories,
      {
        order: [
          { catalogCategoryId: a, sortOrder: 2 },
          { catalogCategoryId: b, sortOrder: 1 },
        ],
      },
    );

    const reorders = (await stamps(t)).filter(
      (s) => s.kind === "categories_reordered",
    );
    expect(reorders).toEqual([
      {
        actorId: admin,
        kind: "categories_reordered",
        targetLabel: "Catalog categories",
        targetId: "catalogCategories",
      },
    ]);
  });

  test("a refused write stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    await expect(
      asMember(t).mutation(
        api.catalog.createCatalogCategory.createCatalogCategory,
        { name: { en: "Animals", nl: "Dieren" }, sortOrder: 1 },
      ),
    ).rejects.toThrow("Forbidden");
    await expect(
      asAdmin(t).mutation(
        api.catalog.setCatalogCategoryActive.setCatalogCategoryActive,
        { catalogCategoryId: crypto.randomUUID(), isActive: false },
      ),
    ).rejects.toThrow();
    expect(await stamps(t)).toEqual([]);
  });
});

describe("contact/markContactMessageHandled", () => {
  const seedMessage = (t: TestConvex<typeof schema>) =>
    t.run((ctx) =>
      ctx.db.insert("contactMessages", {
        name: "Mara de Vries",
        email: "mara@example.com",
        subject: "account",
        message: "Please delete my account and all my data.",
        status: "new",
        createdAt: Date.now(),
      }),
    );

  test("marking a message handled stamps once, without the sender's name or email", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedUsers(t);
    const id = await seedMessage(t);
    const mark = () =>
      asAdmin(t).mutation(
        api.contact.markContactMessageHandled.markContactMessageHandled,
        { id },
      );

    await mark();
    await mark(); // already handled: no-op

    const all = await stamps(t);
    expect(all).toEqual([
      {
        actorId: admin,
        kind: "contact_message_handled",
        targetLabel: "Contact message",
        targetId: id,
      },
    ]);
    expect(JSON.stringify(all)).not.toMatch(/Mara|mara@example\.com/);
  });

  test("a non-admin cannot mark, and nothing is stamped", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);
    const id = await seedMessage(t);
    await expect(
      asMember(t).mutation(
        api.contact.markContactMessageHandled.markContactMessageHandled,
        { id },
      ),
    ).rejects.toThrow("Forbidden");
    expect(await stamps(t)).toEqual([]);
  });
});
