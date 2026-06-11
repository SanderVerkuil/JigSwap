import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  DeleteCollection,
  DeleteCollectionCommand,
} from "../ports/in/delete-collection.port";
import { CollectionRepository } from "../ports/out/collection.repository";

export interface DeleteCollectionDeps {
  readonly collections: CollectionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CollectionNotFound), require ownership, let the aggregate guard
// the default-collection invariant (→ CannotDeleteDefaultCollection), then remove + publish.
export const makeDeleteCollection =
  (deps: DeleteCollectionDeps): DeleteCollection =>
  async (cmd: DeleteCollectionCommand) => {
    const collection = await deps.collections.findById(cmd.collectionId);
    if (!collection)
      return err(LibraryApplicationError.collectionNotFound(cmd.collectionId));
    if (collection.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("delete this collection"));
    }

    const outcome = collection.delete(deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.collections.remove(collection.id);
    await deps.events.publish(collection.pullEvents());
    return ok(undefined);
  };
