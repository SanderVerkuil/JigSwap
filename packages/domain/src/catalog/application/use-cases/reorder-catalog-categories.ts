import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { CatalogCategory } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  ReorderCatalogCategories,
  ReorderCatalogCategoriesCommand,
} from "../ports/in/manage-catalog-category.port";
import { CatalogCategoryRepository } from "../ports/out/catalog-category.repository";

export interface ReorderCatalogCategoriesDeps {
  readonly categories: CatalogCategoryRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load every targeted node (any missing → CatalogCategoryNotFound, before
// any write), reorder each to its new stable position, then persist and publish atomically.
export const makeReorderCatalogCategories =
  (deps: ReorderCatalogCategoriesDeps): ReorderCatalogCategories =>
  async (
    cmd: ReorderCatalogCategoriesCommand,
  ): Promise<Result<void, CatalogApplicationError>> => {
    const loaded: CatalogCategory[] = [];
    for (const entry of cmd.order) {
      const category = await deps.categories.findById(entry.catalogCategoryId);
      if (!category) {
        return err(
          CatalogApplicationError.catalogCategoryNotFound(
            entry.catalogCategoryId,
          ),
        );
      }
      loaded.push(category);
    }

    const now = deps.clock.now();
    for (let i = 0; i < loaded.length; i += 1) {
      const category = loaded[i];
      category.reorder(cmd.order[i].sortOrder, now);
      await deps.categories.save(category);
      await deps.events.publish(category.pullEvents());
    }
    return ok(undefined);
  };
