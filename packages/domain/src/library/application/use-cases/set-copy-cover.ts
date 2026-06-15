import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  SetCopyCover,
  SetCopyCoverCommand,
} from "../ports/in/set-copy-cover.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface SetCopyCoverDeps {
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, delegate the cover selection to the
// aggregate, persist, publish. The "image belongs to this copy" check is a persistence-level
// concern enforced in the Convex composition root (it needs the read model), not here.
export const makeSetCopyCover =
  (deps: SetCopyCoverDeps): SetCopyCover =>
  async (cmd: SetCopyCoverCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("change this copy's cover"));
    }

    const outcome = copy.changeCover(cmd.coverImageId, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };
