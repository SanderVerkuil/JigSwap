import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  ChangeCopyCondition,
  ChangeCopyConditionCommand,
} from "../ports/in/change-copy-condition.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface ChangeCopyConditionDeps {
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, delegate the re-grade to the
// aggregate, persist, publish.
export const makeChangeCopyCondition =
  (deps: ChangeCopyConditionDeps): ChangeCopyCondition =>
  async (cmd: ChangeCopyConditionCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("change this copy's condition"));
    }

    const outcome = copy.changeCondition(cmd.condition, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };
