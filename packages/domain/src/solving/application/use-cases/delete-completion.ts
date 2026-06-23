import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CompletionDeleted, SolvingError } from "../../domain";
import { SolvingApplicationError } from "../errors";
import {
  DeleteCompletion,
  DeleteCompletionCommand,
} from "../ports/in/delete-completion.port";
import { CompletionRepository } from "../ports/out/completion.repository";

export interface DeleteCompletionDeps {
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CompletionNotFound), guard ownership (→ NotCompletionOwner), delete,
// publish CompletionDeleted so the goal-progress reactor recomputes the member's derived progress.
export const makeDeleteCompletion =
  (deps: DeleteCompletionDeps): DeleteCompletion =>
  async (cmd: DeleteCompletionCommand) => {
    const completion = await deps.completions.findById(cmd.completionId);
    if (!completion) {
      return err(SolvingApplicationError.completionNotFound(cmd.completionId));
    }

    if (completion.userId !== cmd.actingMemberId) {
      return err(SolvingError.notCompletionOwner());
    }

    await deps.completions.delete(cmd.completionId);
    await deps.events.publish([
      new CompletionDeleted(
        cmd.completionId,
        completion.userId,
        deps.clock.now(),
      ),
    ]);
    return ok(undefined);
  };
