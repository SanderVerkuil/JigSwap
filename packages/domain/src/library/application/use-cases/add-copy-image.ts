import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CopyImage, LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  AddCopyImage,
  AddCopyImageCommand,
} from "../ports/in/add-copy-image.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface AddCopyImageDeps {
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, attach the image VO, persist, publish.
export const makeAddCopyImage =
  (deps: AddCopyImageDeps): AddCopyImage =>
  async (cmd: AddCopyImageCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("add an image to this copy"));
    }

    const image = CopyImage.create({
      fileId: cmd.fileId,
      title: cmd.title,
      description: cmd.description,
      tag: cmd.tag,
      takenAt: cmd.takenAt,
    });

    const outcome = copy.addImage(image, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };
