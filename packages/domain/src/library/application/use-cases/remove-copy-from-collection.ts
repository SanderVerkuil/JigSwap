import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  CollectionMembershipCommand,
  RemoveCopyFromCollection,
} from "../ports/in/collection-membership.port";
import { CollectionRepository } from "../ports/out/collection.repository";

export interface RemoveCopyFromCollectionDeps {
  readonly collections: CollectionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the collection (→ CollectionNotFound), require ownership, delegate
// removal (→ CopyNotInCollection) to the aggregate, persist, publish.
export const makeRemoveCopyFromCollection =
  (deps: RemoveCopyFromCollectionDeps): RemoveCopyFromCollection =>
  async (cmd: CollectionMembershipCommand) => {
    const collection = await deps.collections.findById(cmd.collectionId);
    if (!collection)
      return err(LibraryApplicationError.collectionNotFound(cmd.collectionId));
    if (collection.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("modify this collection"));
    }

    const outcome = collection.removeCopy(cmd.copyId, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.collections.save(collection);
    await deps.events.publish(collection.pullEvents());
    return ok(undefined);
  };
