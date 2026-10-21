import {
  makeCreateCatalogCategory,
  makeReorderCatalogCategories,
  makeSetCatalogCategoryActive,
  makeUpdateCatalogCategory,
  toCatalogCategoryId,
  type CatalogApplicationError,
  type CatalogCategoryId,
  type CatalogError,
  type LocalizedText,
  type Result,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexCatalogCategoryRepository } from "./adapters/convexCatalogCategoryRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { CATEGORY_FIXTURE, RETIRED_CATEGORIES } from "./categoryFixture";
import { toConvexError } from "./errors";

// One-shot fixture load for the generic catalog taxonomy (see ./categoryFixture). Every write goes
// through the catalog category use cases, so new rows get an aggregateId from the id generator and
// each change records its domain event, exactly like the admin UI. A target matches an existing row
// by its known aggregateId first, then by case-insensitive English name; unmatched targets are
// created. Retired rows are deactivated, never deleted. Idempotent: a second run reports every row
// as unchanged. dryRun (the default) only reports the plan and writes nothing.
// Run manually (dry run FIRST, check the plan, then for real):
//   npx convex run --deployment-name giddy-octopus-727 catalog/seedCategories:run
//   npx convex run --deployment-name giddy-octopus-727 catalog/seedCategories:run '{"dryRun": false}'
//   npx convex run --deployment-name spotted-scorpion-690 catalog/seedCategories:run
//   npx convex run --deployment-name spotted-scorpion-690 catalog/seedCategories:run '{"dryRun": false}'

type Row = Doc<"adminCategories">;

interface PlanEntry {
  aggregateId?: string;
  name: string;
  previousName?: string;
  changes?: string[];
}

const nameKey = (en: string) => en.trim().toLowerCase();
const sameText = (a: LocalizedText | undefined, b: LocalizedText) =>
  a !== undefined && a.en === b.en && a.nl === b.nl;

const orThrow = <T>(
  result: Result<T, CatalogError | CatalogApplicationError>,
): T => {
  if (result.isErr) throw toConvexError(result.error);
  return result.value;
};

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true; // safe by default
    const rows = await ctx.db.query("adminCategories").collect();

    // The repository loads rows by aggregateId; a legacy row without one can't be driven.
    if (rows.some((row) => !row.aggregateId)) {
      throw new ConvexError(
        "adminCategories has rows without an aggregateId; run catalog/backfillCategories:run first",
      );
    }

    // Two passes so a name match can never take a row another entry pins by aggregateId.
    const wanted = [
      ...CATEGORY_FIXTURE.map((target) => ({
        aggregateId: target.aggregateId,
        en: target.name.en,
      })),
      ...RETIRED_CATEGORIES,
    ];
    const matches = new Map<number, Row>();
    const claimed = new Set<Row["_id"]>();
    const claim = (index: number, row: Row | undefined) => {
      if (!row) return;
      matches.set(index, row);
      claimed.add(row._id);
    };
    wanted.forEach((entry, index) => {
      if (!entry.aggregateId) return;
      claim(
        index,
        rows.find((row) => row.aggregateId === entry.aggregateId),
      );
    });
    wanted.forEach((entry, index) => {
      if (matches.has(index)) return;
      claim(
        index,
        rows.find(
          (row) =>
            !claimed.has(row._id) && nameKey(row.name.en) === nameKey(entry.en),
        ),
      );
    });

    const deps = {
      categories: convexCatalogCategoryRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    };
    const createUseCase = makeCreateCatalogCategory({
      ...deps,
      ids: catalogIdGenerator,
    });
    const updateUseCase = makeUpdateCatalogCategory(deps);
    const setActiveUseCase = makeSetCatalogCategoryActive(deps);
    const reorderUseCase = makeReorderCatalogCategories(deps);

    const created: PlanEntry[] = [];
    const updated: PlanEntry[] = [];
    const deactivated: PlanEntry[] = [];
    const unchanged: PlanEntry[] = [];
    const reorder: {
      catalogCategoryId: CatalogCategoryId;
      sortOrder: number;
    }[] = [];

    for (const [index, target] of CATEGORY_FIXTURE.entries()) {
      const sortOrder = index + 1;
      const row = matches.get(index);

      if (!row) {
        const entry: PlanEntry = { name: target.name.en };
        if (!dryRun) {
          const id = orThrow(
            await createUseCase({
              name: target.name,
              description: target.description,
              color: target.color,
              sortOrder,
            }),
          );
          entry.aggregateId = id as string;
        }
        created.push(entry);
        continue;
      }

      const aggregateId = row.aggregateId as string;
      const catalogCategoryId = toCatalogCategoryId(aggregateId);
      const nameChanged = !sameText(row.name, target.name);
      const descriptionChanged = !sameText(row.description, target.description);
      const colorChanged = row.color !== target.color;
      const changes = [
        ...(nameChanged ? ["name"] : []),
        ...(descriptionChanged ? ["description"] : []),
        ...(colorChanged ? ["color"] : []),
        ...(row.sortOrder !== sortOrder ? ["sortOrder"] : []),
        ...(row.isActive ? [] : ["activated"]),
      ];
      if (changes.length === 0) {
        unchanged.push({ aggregateId, name: target.name.en });
        continue;
      }
      updated.push({
        aggregateId,
        name: target.name.en,
        ...(row.name.en !== target.name.en
          ? { previousName: row.name.en }
          : {}),
        changes,
      });
      if (dryRun) continue;

      if (nameChanged || descriptionChanged || colorChanged) {
        orThrow(
          await updateUseCase({
            catalogCategoryId,
            changes: {
              name: nameChanged ? target.name : undefined,
              description: descriptionChanged ? target.description : undefined,
              color: colorChanged ? target.color : undefined,
            },
          }),
        );
      }
      if (row.sortOrder !== sortOrder) {
        reorder.push({ catalogCategoryId, sortOrder });
      }
      if (!row.isActive) {
        orThrow(await setActiveUseCase({ catalogCategoryId, isActive: true }));
      }
    }

    if (reorder.length > 0) {
      orThrow(await reorderUseCase({ order: reorder }));
    }

    // Retired rows that don't exist on this deployment are simply skipped.
    for (let offset = 0; offset < RETIRED_CATEGORIES.length; offset += 1) {
      const row = matches.get(CATEGORY_FIXTURE.length + offset);
      if (!row) continue;
      const entry = {
        aggregateId: row.aggregateId as string,
        name: row.name.en,
      };
      if (!row.isActive) {
        unchanged.push(entry);
        continue;
      }
      deactivated.push(entry);
      if (dryRun) continue;
      orThrow(
        await setActiveUseCase({
          catalogCategoryId: toCatalogCategoryId(entry.aggregateId),
          isActive: false,
        }),
      );
    }

    return { dryRun, created, updated, deactivated, unchanged };
  },
});
