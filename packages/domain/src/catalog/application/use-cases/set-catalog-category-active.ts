import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  SetCatalogCategoryActive,
  SetCatalogCategoryActiveCommand,
} from "../ports/in/manage-catalog-category.port";
import { CatalogCategoryRepository } from "../ports/out/catalog-category.repository";

export interface SetCatalogCategoryActiveDeps {
  readonly categories: CatalogCategoryRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CatalogCategoryNotFound), soft (de)activate (never delete),
// persist, publish. The aggregate makes the toggle idempotent (no event when unchanged).
export const makeSetCatalogCategoryActive =
  (deps: SetCatalogCategoryActiveDeps): SetCatalogCategoryActive =>
  async (
    cmd: SetCatalogCategoryActiveCommand,
  ): Promise<Result<void, CatalogApplicationError>> => {
    const category = await deps.categories.findById(cmd.catalogCategoryId);
    if (!category) {
      return err(
        CatalogApplicationError.catalogCategoryNotFound(cmd.catalogCategoryId),
      );
    }

    const now = deps.clock.now();
    if (cmd.isActive) category.activate(now);
    else category.deactivate(now);

    await deps.categories.save(category);
    await deps.events.publish(category.pullEvents());
    return ok(undefined);
  };
