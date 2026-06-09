import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  AddCopyToCollection,
  CollectionMembershipCommand,
} from "../ports/in/collection-membership.port";
import { CollectionRepository } from "../ports/out/collection.repository";
import { CopyRepository } from "../ports/out/copy.repository";

export interface AddCopyToCollectionDeps {
  readonly collections: CollectionRepository;
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script enforcing the "membership references only the owner's own copies" rule:
// load the collection (→ CollectionNotFound) and the copy (→ CopyNotFound); require the acting
// member to own the collection and the copy to belong to the same owner; then delegate the
// structural rule (no copies in a wishlist) + de-dup to the aggregate.
export const makeAddCopyToCollection =
  (deps: AddCopyToCollectionDeps): AddCopyToCollection =>
  async (cmd: CollectionMembershipCommand) => {
    const collection = await deps.collections.findById(cmd.collectionId);
    if (!collection)
      return err(LibraryApplicationError.collectionNotFound(cmd.collectionId));
    if (collection.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("modify this collection"));
    }

    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== collection.ownerId) {
      return err(LibraryApplicationError.notCopyOwner(cmd.copyId));
    }

    const outcome = collection.addCopy(cmd.copyId, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.collections.save(collection);
    await deps.events.publish(collection.pullEvents());
    return ok(undefined);
  };
