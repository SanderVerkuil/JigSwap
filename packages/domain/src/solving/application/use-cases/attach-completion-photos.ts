import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Photo } from "../../domain";
import { SolvingApplicationError } from "../errors";
import {
  AttachCompletionPhotos,
  AttachCompletionPhotosCommand,
} from "../ports/in/attach-completion-photos.port";
import { CompletionRepository } from "../ports/out/completion.repository";

export interface AttachCompletionPhotosDeps {
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CompletionNotFound), then delegate to the aggregate's
// attachPhotos(), which enforces ownership (NotCompletionOwner) and the photo cap
// (TooManyPhotos); persist, publish.
export const makeAttachCompletionPhotos =
  (deps: AttachCompletionPhotosDeps): AttachCompletionPhotos =>
  async (cmd: AttachCompletionPhotosCommand) => {
    const completion = await deps.completions.findById(cmd.completionId);
    if (!completion) {
      return err(SolvingApplicationError.completionNotFound(cmd.completionId));
    }

    const outcome = completion.attachPhotos(
      cmd.actingMemberId,
      cmd.photoFileIds.map((id) => Photo.of(id)),
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.completions.save(completion);
    await deps.events.publish(completion.pullEvents());
    return ok(undefined);
  };
