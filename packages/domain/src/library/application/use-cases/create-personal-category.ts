import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { PersonalCategory } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  CreatePersonalCategory,
  CreatePersonalCategoryCommand,
} from "../ports/in/create-personal-category.port";
import { PersonalCategoryIdGenerator } from "../ports/out/id-generators";
import { PersonalCategoryRepository } from "../ports/out/personal-category.repository";

export interface CreatePersonalCategoryDeps {
  readonly categories: PersonalCategoryRepository;
  readonly ids: PersonalCategoryIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce (owner, name) uniqueness, create the aggregate, persist, publish.
export const makeCreatePersonalCategory =
  (deps: CreatePersonalCategoryDeps): CreatePersonalCategory =>
  async (cmd: CreatePersonalCategoryCommand) => {
    const existing = await deps.categories.findByOwnerAndName(
      cmd.ownerId,
      cmd.name,
    );
    if (existing)
      return err(LibraryApplicationError.duplicateCollectionName(cmd.name));

    const category = PersonalCategory.create({
      id: deps.ids.next(),
      ownerId: cmd.ownerId,
      name: cmd.name,
      color: cmd.color,
      description: cmd.description,
      now: deps.clock.now(),
    });
    if (category.isErr) return err(category.error);

    await deps.categories.save(category.value);
    await deps.events.publish(category.value.pullEvents());
    return ok(category.value.id);
  };
