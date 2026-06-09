import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { CatalogError } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  UpdateCatalogCategory,
  UpdateCatalogCategoryCommand,
} from "../ports/in/manage-catalog-category.port";
import { CatalogCategoryRepository } from "../ports/out/catalog-category.repository";

export interface UpdateCatalogCategoryDeps {
  readonly categories: CatalogCategoryRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CatalogCategoryNotFound), delegate the patch to the aggregate
// (it re-checks name completeness), persist, publish.
export const makeUpdateCatalogCategory =
  (deps: UpdateCatalogCategoryDeps): UpdateCatalogCategory =>
  async (
    cmd: UpdateCatalogCategoryCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
    const category = await deps.categories.findById(cmd.catalogCategoryId);
    if (!category) {
      return err(CatalogApplicationError.catalogCategoryNotFound(cmd.catalogCategoryId));
    }

    const outcome = category.update(cmd.changes, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.categories.save(category);
    await deps.events.publish(category.pullEvents());
    return ok(undefined);
  };
