import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  UpdateCollection,
  UpdateCollectionCommand,
} from "../ports/in/update-collection.port";
import { CollectionRepository } from "../ports/out/collection.repository";

export interface UpdateCollectionDeps {
  readonly collections: CollectionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CollectionNotFound), require ownership, and — only when the name
// actually changes — enforce (owner, name) uniqueness via the repository before delegating the
// patch to the aggregate. Uniqueness needs the repository, so it lives here, mirroring
// CreateCollection; the aggregate records CollectionUpdated.
export const makeUpdateCollection =
  (deps: UpdateCollectionDeps): UpdateCollection =>
  async (cmd: UpdateCollectionCommand) => {
    const collection = await deps.collections.findById(cmd.collectionId);
    if (!collection)
      return err(LibraryApplicationError.collectionNotFound(cmd.collectionId));
    if (collection.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("update this collection"));
    }

    if (cmd.name !== undefined && cmd.name !== collection.name) {
      const existing = await deps.collections.findByOwnerAndName(
        collection.ownerId,
        cmd.name,
      );
      if (existing && existing.id !== collection.id) {
        return err(LibraryApplicationError.duplicateCollectionName(cmd.name));
      }
    }

    const outcome = collection.update(
      {
        name: cmd.name,
        description: cmd.description,
        visibility: cmd.visibility,
        color: cmd.color,
        icon: cmd.icon,
        personalNotes: cmd.personalNotes,
      },
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.collections.save(collection);
    await deps.events.publish(collection.pullEvents());
    return ok(undefined);
  };
