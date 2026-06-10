import { beforeEach, describe, expect, it } from "vitest";
import { toCatalogCategoryId } from "../../../shared-kernel";
import { CatalogCategoryId, LocalizedText } from "../../domain";
import {
  FixedClock,
  InMemoryCatalogCategoryRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeCreateCatalogCategory } from "./create-catalog-category";
import { makeReorderCatalogCategories } from "./reorder-catalog-categories";
import { makeSetCatalogCategoryActive } from "./set-catalog-category-active";
import { makeUpdateCatalogCategory } from "./update-catalog-category";

const NOW = new Date("2026-06-08T10:00:00Z");
const name = (en: string, nl: string): LocalizedText => ({ en, nl });

describe("Catalog category use cases", () => {
  let repo: InMemoryCatalogCategoryRepository;
  let events: RecordingEventPublisher;
  let deps: {
    categories: InMemoryCatalogCategoryRepository;
    ids: SequentialIdGenerator;
    events: RecordingEventPublisher;
    clock: FixedClock;
  };

  beforeEach(() => {
    repo = new InMemoryCatalogCategoryRepository();
    events = new RecordingEventPublisher();
    deps = {
      categories: repo,
      ids: new SequentialIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    };
  });

  const createOk = async (
    en: string,
    sortOrder: number,
  ): Promise<CatalogCategoryId> => {
    const create = makeCreateCatalogCategory(deps);
    const r = await create({ name: name(en, en), sortOrder });
    if (!r.isOk) throw new Error(`create failed: ${r.error.code}`);
    return r.value;
  };

  it("creates a category and publishes CatalogCategoryCreated", async () => {
    const id = await createOk("Landscapes", 0);
    expect(repo.size()).toBe(1);
    expect(events.names()).toEqual(["CatalogCategoryCreated"]);
    expect(id).toBe(toCatalogCategoryId("cc-1"));
  });

  it("rejects creation with an incomplete name (EmptyCategoryName)", async () => {
    const create = makeCreateCatalogCategory(deps);
    const r = await create({ name: name("EN only", ""), sortOrder: 0 });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyCategoryName");
  });

  it("updates a category and publishes CatalogCategoryUpdated", async () => {
    const id = await createOk("Landscapes", 0);
    events.published.length = 0;
    const update = makeUpdateCatalogCategory(deps);
    const r = await update({
      catalogCategoryId: id,
      changes: { color: "#123456" },
    });
    expect(r.isOk).toBe(true);
    expect(events.names()).toEqual(["CatalogCategoryUpdated"]);
  });

  it("rejects updating an unknown category (CatalogCategoryNotFound)", async () => {
    const update = makeUpdateCatalogCategory(deps);
    const r = await update({
      catalogCategoryId: toCatalogCategoryId("missing"),
      changes: { color: "#000" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CatalogCategoryNotFound");
  });

  // The aggregate re-checks name completeness; the use case must surface that error rather
  // than save (kills the `if (outcome.isErr)` → false mutant).
  it("surfaces the aggregate's EmptyCategoryName on an incomplete replacement name", async () => {
    const id = await createOk("Landscapes", 0);
    events.published.length = 0;
    const update = makeUpdateCatalogCategory(deps);
    const r = await update({
      catalogCategoryId: id,
      changes: { name: name("EN only", "") },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyCategoryName");
    expect(events.published).toHaveLength(0); // nothing persisted/published
  });

  it("soft-deactivates so the node drops out of listActive but is not deleted", async () => {
    const id = await createOk("Landscapes", 0);
    const setActive = makeSetCatalogCategoryActive(deps);
    const r = await setActive({ catalogCategoryId: id, isActive: false });
    expect(r.isOk).toBe(true);
    expect(await repo.findById(id)).not.toBeNull(); // still stored
    expect(await repo.listActive()).toHaveLength(0);
    expect(repo.size()).toBe(1);
  });

  // The use case branches on cmd.isActive: reactivating a deactivated node must restore it to
  // listActive, proving the activate path is taken (kills `if (cmd.isActive)` → false).
  it("reactivates a previously deactivated category", async () => {
    const id = await createOk("Landscapes", 0);
    const setActive = makeSetCatalogCategoryActive(deps);
    await setActive({ catalogCategoryId: id, isActive: false });
    expect(await repo.listActive()).toHaveLength(0);

    const r = await setActive({ catalogCategoryId: id, isActive: true });
    expect(r.isOk).toBe(true);
    expect(await repo.listActive()).toHaveLength(1);
  });

  it("rejects (de)activating an unknown category", async () => {
    const setActive = makeSetCatalogCategoryActive(deps);
    const r = await setActive({
      catalogCategoryId: toCatalogCategoryId("ghost"),
      isActive: true,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CatalogCategoryNotFound");
  });

  it("reorders categories and reflects the new order in listActive", async () => {
    const a = await createOk("A", 0);
    const b = await createOk("B", 1);
    events.published.length = 0;

    const reorder = makeReorderCatalogCategories(deps);
    const r = await reorder({
      order: [
        { catalogCategoryId: a, sortOrder: 10 },
        { catalogCategoryId: b, sortOrder: 5 },
      ],
    });
    expect(r.isOk).toBe(true);
    expect(events.names()).toEqual([
      "CatalogCategoryReordered",
      "CatalogCategoryReordered",
    ]);

    const ordered = (await repo.listActive()).map((c) => c.id);
    expect(ordered).toEqual([b, a]); // b now sorts before a
  });

  it("reorder fails atomically if any targeted category is missing", async () => {
    const a = await createOk("A", 0);
    const reorder = makeReorderCatalogCategories(deps);
    const r = await reorder({
      order: [
        { catalogCategoryId: a, sortOrder: 9 },
        {
          catalogCategoryId: toCatalogCategoryId("missing"),
          sortOrder: 1,
        },
      ],
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CatalogCategoryNotFound");
    // a must not have moved (validation happens before any write)
    const stored = await repo.findById(a);
    expect(stored?.sortOrder).toBe(0);
  });
});
