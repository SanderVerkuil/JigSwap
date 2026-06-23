import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SolvingError } from "../../domain";
import { SolvingApplicationError } from "../errors";
import {
  FinishCompletion,
  FinishCompletionCommand,
} from "../ports/in/finish-completion.port";
import { CompletionRepository } from "../ports/out/completion.repository";

export interface FinishCompletionDeps {
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CompletionNotFound), check ownership, finish the in-progress
// completion (→ CompletionRecorded), persist, publish.
export const makeFinishCompletion =
  (deps: FinishCompletionDeps): FinishCompletion =>
  async (cmd: FinishCompletionCommand) => {
    const completion = await deps.completions.findById(cmd.completionId);
    if (!completion) {
      return err(SolvingApplicationError.completionNotFound(cmd.completionId));
    }
    if (completion.userId !== cmd.actingMemberId) {
      return err(SolvingError.notCompletionOwner());
    }

    const outcome = completion.finish(
      cmd.endDate,
      deps.clock.now(),
      cmd.completionTimeMinutes,
      cmd.allPiecesPresent,
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.completions.save(completion);
    await deps.events.publish(completion.pullEvents());
    return ok(undefined);
  };
