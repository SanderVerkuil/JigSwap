import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A valid EAN-13 (correct GS1 check digits) the barcode VO will accept.
const VALID_EAN = "4006381333931";

// Seed a single member; the Clerk subject maps to the user via by_clerk_id.
const seedMember = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

// Alice acting as an admin: the moderation + taxonomy mutations now assert isAdmin server-side
// (the role lives in the Clerk JWT's metadata.role claim). Keep the same Clerk subject so the
// resolved member is still the seeded `clerk_alice`.
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Seed two members (alice + bob); mirrors changeProposalDecisions.test.ts's helper, needed for
// tests where the acting admin must be a DIFFERENT member than the submitter.
const seedMembers = async (t: ReturnType<typeof convexTest>) =>
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
      alice: await mkUser("clerk_alice", "Alice"),
      bob: await mkUser("clerk_bob", "Bob"),
    };
  });

const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });

const puzzleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const categoryRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
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

describe("catalog.submitPuzzleDefinition", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expect(
      t.mutation(api.catalog.submitPuzzleDefinition.submitPuzzleDefinition, {
        title: "Mountain Vista",
        pieceCount: 1000,
      }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("submits as pending, materialises searchableText, and derives submittedBy from auth", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      {
        title: "Mountain Vista",
        brand: "Ravensburger",
        publisher: "Jumbo",
        artist: "Jane Doe",
        series: "Nature",
        pieceCount: 1000,
        tags: ["landscape", "mountains"],
      },
    );
    expect(typeof id).toBe("string");

    const row = await puzzleRow(t, id);
    expect(row?.status).toBe("pending"); // DIVERGENCE vs legacy auto-approve
    expect(row?.submittedBy).toBe(alice); // from auth, not args
    expect(row?.publisher).toBe("Jumbo");
    expect(row?.searchableText).toContain("Jumbo");
  });

  test("rejects a duplicate barcode against a seeded definition", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    // Seed an existing puzzle carrying the EAN.
    await t.run(async (ctx) => {
      const now = Date.now();
      const owner = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_alice"))
        .unique();
      await ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title: "Existing",
        pieceCount: 500,
        ean: VALID_EAN,
        searchableText: "Existing",
        status: "approved",
        submittedBy: owner!._id,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expectConvexCode(
      asAlice(t).mutation(
        api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
        {
          title: "Duplicate",
          pieceCount: 1000,
          ean: VALID_EAN,
        },
      ),
      "DuplicateBarcode",
    );
  });

  test("rejects a malformed barcode (aggregate invariant)", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expectConvexCode(
      asAlice(t).mutation(
        api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
        {
          title: "Bad Barcode",
          pieceCount: 1000,
          ean: "123",
        },
      ),
      "InvalidBarcode",
    );
  });

  // Regression: the `category` column is typed `v.id("adminCategories")`, so passing a raw
  // CatalogCategoryId aggregateId would make Convex reject the write. The repository must resolve
  // the real document id on write and map it back on read.
  test("submits with a category, persisting the real id and round-tripping the aggregateId", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const categoryId = (await asAdmin(t).mutation(
      api.catalog.createCatalogCategory.createCatalogCategory,
      { name: { en: "Animals", nl: "Dieren" }, sortOrder: 1 },
    )) as string;
    const realCategoryId = (await categoryRow(t, categoryId))?._id;

    // No validator error despite passing the aggregateId (not a document id).
    const id = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Lions", pieceCount: 1000, category: categoryId },
    );

    // The stored FK is the genuine `adminCategories._id`, not the aggregateId.
    const row = await puzzleRow(t, id as string);
    expect(row?.category).toBe(realCategoryId);
    expect(row?.category).not.toBe(categoryId);

    // Round-trip: a domain re-load+save (via update) keeps the same resolved FK — proving the
    // read path maps the FK back to the aggregateId the aggregate carries.
    await asAlice(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      {
        puzzleDefinitionId: id as string,
        title: "Lions Reworked",
      },
    );
    expect((await puzzleRow(t, id as string))?.category).toBe(realCategoryId);
  });
});

// Helper: Alice submits a pending definition, returning the aggregateId.
const submitPending = async (t: ReturnType<typeof convexTest>) => {
  await seedMember(t);
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  return id as string;
};

describe("catalog moderation lifecycle", () => {
  // Authz audit: moderation is admin-only server-side; a plain member (route
  // guards aside) must be rejected before any state transition happens.
  test("approve rejects a non-admin member (Forbidden)", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await expect(
      asAlice(t).mutation(
        api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
    expect((await puzzleRow(t, id))?.status).toBe("pending");
  });

  test("reject rejects a non-admin member (Forbidden)", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await expect(
      asAlice(t).mutation(
        api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
    expect((await puzzleRow(t, id))?.status).toBe("pending");
  });

  test("approve moves pending -> approved", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await asAdmin(t).mutation(
      api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
      {
        puzzleDefinitionId: id,
      },
    );
    expect((await puzzleRow(t, id))?.status).toBe("approved");
  });

  test("reject moves pending -> rejected", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await asAdmin(t).mutation(
      api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
      {
        puzzleDefinitionId: id,
      },
    );
    expect((await puzzleRow(t, id))?.status).toBe("rejected");
  });

  test("illegal transition rejected (approve an already-rejected definition)", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await asAdmin(t).mutation(
      api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
      {
        puzzleDefinitionId: id,
      },
    );
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
        {
          puzzleDefinitionId: id,
        },
      ),
      "IllegalApprovalTransition",
    );
  });

  test("approve of a missing definition => PuzzleDefinitionNotFound", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
        {
          puzzleDefinitionId: crypto.randomUUID(),
        },
      ),
      "PuzzleDefinitionNotFound",
    );
  });
});

describe("catalog.updatePuzzleDefinition", () => {
  test("patches fields and re-materialises searchableText", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await asAlice(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      {
        puzzleDefinitionId: id,
        title: "Renamed Vista",
        brand: "Clementoni",
      },
    );
    const row = await puzzleRow(t, id);
    expect(row?.title).toBe("Renamed Vista");
    expect(row?.brand).toBe("Clementoni");
    expect(row?.searchableText).toBe("Renamed Vista Clementoni");
  });

  test("an empty replacement title is rejected", async () => {
    const t = convexTest(schema, modules);
    const id = await submitPending(t);
    await expectConvexCode(
      asAlice(t).mutation(
        api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
        {
          puzzleDefinitionId: id,
          title: "   ",
        },
      ),
      "EmptyTitle",
    );
  });

  test("an admin editing someone else's definition stamps definition_edited with the post-edit title", async () => {
    const t = convexTest(schema, modules);
    // Seed: bob submits; admin (a DIFFERENT member) edits.
    const { alice } = await seedMembers(t);
    const id = await asBob(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Mountain Vista", pieceCount: 1000 },
    );

    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: id as string, title: "Mountain Vista II" },
    );

    const actions = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    const stamp = actions.find((a) => a.kind === "definition_edited");
    expect(stamp).toMatchObject({
      actorId: alice,
      targetId: id,
      targetLabel: "Mountain Vista II", // post-edit title, matching the sibling stamps' convention
    });
  });

  test("a submitter self-edit does NOT stamp definition_edited", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await asBob(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Mountain Vista", pieceCount: 1000 },
    );

    await asBob(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: id as string, title: "Renamed By Owner" },
    );

    const actions = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(actions.some((a) => a.kind === "definition_edited")).toBe(false);
  });

  test("patches publisher and re-materialises searchableText", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Roadworks", brand: "Jan van Haasteren", pieceCount: 1000 },
    );
    await asAlice(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: id as string, publisher: "Jumbo" },
    );
    const row = await puzzleRow(t, id as string);
    expect(row?.publisher).toBe("Jumbo");
    expect(row?.searchableText).toContain("Jumbo");
    expect(row?.brand).toBe("Jan van Haasteren"); // untouched
  });
});

describe("catalog category management", () => {
  const NAME = { en: "Animals", nl: "Dieren" };

  const createCategory = async (
    t: ReturnType<typeof convexTest>,
    sortOrder: number,
    name = NAME,
  ) =>
    (await asAdmin(t).mutation(
      api.catalog.createCatalogCategory.createCatalogCategory,
      { name, sortOrder },
    )) as string;

  // Authz audit: taxonomy writes are admin-only server-side.
  test("create rejects a non-admin member (Forbidden)", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expect(
      asAlice(t).mutation(
        api.catalog.createCatalogCategory.createCatalogCategory,
        { name: NAME, sortOrder: 0 },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("create starts active with the given sortOrder", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await createCategory(t, 3);
    const row = await categoryRow(t, id);
    expect(row?.isActive).toBe(true);
    expect(row?.sortOrder).toBe(3);
    expect(row?.name).toEqual(NAME);
  });

  test("rejects a half-translated name", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.createCatalogCategory.createCatalogCategory,
        {
          name: { en: "Animals", nl: "  " },
          sortOrder: 1,
        },
      ),
      "EmptyCategoryName",
    );
  });

  test("reorder updates each node's sortOrder", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const a = await createCategory(t, 1, { en: "A", nl: "A" });
    const b = await createCategory(t, 2, { en: "B", nl: "B" });
    await asAdmin(t).mutation(
      api.catalog.reorderCatalogCategories.reorderCatalogCategories,
      {
        order: [
          { catalogCategoryId: a, sortOrder: 5 },
          { catalogCategoryId: b, sortOrder: 4 },
        ],
      },
    );
    expect((await categoryRow(t, a))?.sortOrder).toBe(5);
    expect((await categoryRow(t, b))?.sortOrder).toBe(4);
  });

  test("deactivate soft-hides the node (no delete)", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await createCategory(t, 1);
    await asAdmin(t).mutation(
      api.catalog.setCatalogCategoryActive.setCatalogCategoryActive,
      { catalogCategoryId: id, isActive: false },
    );
    const row = await categoryRow(t, id);
    expect(row).not.toBeNull(); // still present
    expect(row?.isActive).toBe(false);
  });
});
