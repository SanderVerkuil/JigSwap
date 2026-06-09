import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { CatalogCategory, CatalogCategoryId, CatalogError } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  CreateCatalogCategory,
  CreateCatalogCategoryCommand,
} from "../ports/in/manage-catalog-category.port";
import { CatalogCategoryRepository } from "../ports/out/catalog-category.repository";
import { CatalogIdGenerator } from "../ports/out/catalog-id-generator";

export interface CreateCatalogCategoryDeps {
  readonly categories: CatalogCategoryRepository;
  readonly ids: CatalogIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint id, delegate name-completeness to the aggregate, persist, publish.
export const makeCreateCatalogCategory =
  (deps: CreateCatalogCategoryDeps): CreateCatalogCategory =>
  async (
    cmd: CreateCatalogCategoryCommand,
  ): Promise<Result<CatalogCategoryId, CatalogError | CatalogApplicationError>> => {
    const category = CatalogCategory.create({
      id: deps.ids.nextCatalogCategoryId(),
      name: cmd.name,
      sortOrder: cmd.sortOrder,
      now: deps.clock.now(),
      description: cmd.description,
      color: cmd.color,
    });
    if (category.isErr) return err(category.error);

    await deps.categories.save(category.value);
    await deps.events.publish(category.value.pullEvents());
    return ok(category.value.id);
  };
