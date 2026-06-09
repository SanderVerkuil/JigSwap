import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { CatalogError, PuzzleDefinition, PuzzleDefinitionId } from "../../domain";
import { CatalogApplicationError } from "../errors";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

export interface DefinitionActionDeps {
  readonly definitions: PuzzleDefinitionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// An aggregate mutation that may fail an entity rule (approve/reject/update share the
// (now) → Result shape once their command args are bound).
type AggregateAction = (
  definition: PuzzleDefinition,
  now: Date,
) => Result<void, CatalogError>;

// Shared transaction script: load (→ PuzzleDefinitionNotFound), invoke the aggregate method
// (it owns the entity rules), persist, publish.
export const runDefinitionAction =
  (deps: DefinitionActionDeps, action: AggregateAction) =>
  async (
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
    const definition = await deps.definitions.findById(puzzleDefinitionId);
    if (!definition) {
      return err(CatalogApplicationError.puzzleDefinitionNotFound(puzzleDefinitionId));
    }

    const outcome = action(definition, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.definitions.save(definition);
    await deps.events.publish(definition.pullEvents());
    return ok(undefined);
  };
