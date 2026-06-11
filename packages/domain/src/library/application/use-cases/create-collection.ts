import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Collection } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  CreateCollection,
  CreateCollectionCommand,
} from "../ports/in/create-collection.port";
import { CollectionRepository } from "../ports/out/collection.repository";
import { CollectionIdGenerator } from "../ports/out/id-generators";

export interface CreateCollectionDeps {
  readonly collections: CollectionRepository;
  readonly ids: CollectionIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce (owner, name) uniqueness via the repository, then create the
// aggregate, persist, publish.
export const makeCreateCollection =
  (deps: CreateCollectionDeps): CreateCollection =>
  async (cmd: CreateCollectionCommand) => {
    const existing = await deps.collections.findByOwnerAndName(
      cmd.ownerId,
      cmd.name,
    );
    if (existing)
      return err(LibraryApplicationError.duplicateCollectionName(cmd.name));

    const collection = Collection.create({
      id: deps.ids.next(),
      ownerId: cmd.ownerId,
      name: cmd.name,
      description: cmd.description,
      visibility: cmd.visibility,
      color: cmd.color,
      icon: cmd.icon,
      isWishlist: cmd.isWishlist,
      personalNotes: cmd.personalNotes,
      now: deps.clock.now(),
    });
    if (collection.isErr) return err(collection.error);

    await deps.collections.save(collection.value);
    await deps.events.publish(collection.value.pullEvents());
    return ok(collection.value.id);
  };
