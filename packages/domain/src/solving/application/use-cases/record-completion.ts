import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Completion, Photo } from "../../domain";
import {
  RecordCompletion,
  RecordCompletionCommand,
} from "../ports/in/record-completion.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { CompletionIdGenerator } from "../ports/out/id-generators";

export interface RecordCompletionDeps {
  readonly completions: CompletionRepository;
  readonly ids: CompletionIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: build an already-finished Completion, persist, publish. Goal progress is
// recomputed separately in reaction to CompletionRecorded.
export const makeRecordCompletion =
  (deps: RecordCompletionDeps): RecordCompletion =>
  async (cmd: RecordCompletionCommand) => {
    const completion = Completion.record({
      id: deps.ids.next(),
      userId: cmd.userId,
      puzzleDefinitionId: cmd.puzzleDefinitionId,
      copyId: cmd.copyId,
      startDate: cmd.startDate,
      endDate: cmd.endDate,
      completionTimeMinutes: cmd.completionTimeMinutes,
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
