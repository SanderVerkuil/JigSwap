import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Photo } from "../../domain";
import { SolvingApplicationError } from "../errors";
import {
  EditCompletion,
  EditCompletionCommand,
} from "../ports/in/edit-completion.port";
import { CompletionRepository } from "../ports/out/completion.repository";

export interface EditCompletionDeps {
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CompletionNotFound), then delegate to the aggregate's edit(), which
// enforces ownership (NotCompletionOwner) and the 24h window (EditWindowClosed); persist, publish.
export const makeEditCompletion =
  (deps: EditCompletionDeps): EditCompletion =>
  async (cmd: EditCompletionCommand) => {
    const completion = await deps.completions.findById(cmd.completionId);
    if (!completion) {
      return err(SolvingApplicationError.completionNotFound(cmd.completionId));
    }

    const outcome = completion.edit(
      cmd.actingMemberId,
      {
        notes: cmd.notes,
        photos: cmd.photoFileIds?.map((id) => Photo.of(id)),
        startDate: cmd.startDate,
        endDate: cmd.endDate,
        completionTimeMinutes: cmd.completionTimeMinutes,
      },
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.completions.save(completion);
    await deps.events.publish(completion.pullEvents());
    return ok(undefined);
  };
