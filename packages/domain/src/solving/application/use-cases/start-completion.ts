import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Completion, Photo } from "../../domain";
import {
  StartCompletion,
  StartCompletionCommand,
} from "../ports/in/start-completion.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { CompletionIdGenerator } from "../ports/out/id-generators";

export interface StartCompletionDeps {
  readonly completions: CompletionRepository;
  readonly ids: CompletionIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint an in-progress Completion (no end/duration yet), persist, publish.
export const makeStartCompletion =
  (deps: StartCompletionDeps): StartCompletion =>
  async (cmd: StartCompletionCommand) => {
    const completion = Completion.start({
      id: deps.ids.next(),
      userId: cmd.userId,
      puzzleDefinitionId: cmd.puzzleDefinitionId,
      copyId: cmd.copyId,
      startDate: cmd.startDate,
      notes: cmd.notes,
      photos: cmd.photoFileIds?.map((id) => Photo.of(id)),
      allPiecesPresent: cmd.allPiecesPresent,
      now: deps.clock.now(),
    });
    if (completion.isErr) return err(completion.error);

    await deps.completions.save(completion.value);
    await deps.events.publish(completion.value.pullEvents());
    return ok(completion.value.id);
  };
