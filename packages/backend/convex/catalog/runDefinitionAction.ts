import {
  type CatalogApplicationError,
  type CatalogError,
  type DefinitionActionDeps,
  type PuzzleDefinitionId,
  type Result,
  toId,
} from "@jigswap/domain";
import type { MutationCtx } from "../_generated/server";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

type DefinitionUseCase = (cmd: {
  puzzleDefinitionId: PuzzleDefinitionId;
}) => Promise<Result<void, CatalogError | CatalogApplicationError>>;

// Shared composition root for the moderation/update mutations: authenticate, wire adapters,
// invoke the use-case factory, map the result. Keeps each mutation file a thin shell. Auth is
// required so only a known member may moderate; finer admin ACL is a later (2d) concern.
export const runDefinitionAction = async (
  ctx: MutationCtx,
  puzzleDefinitionId: string,
  make: (deps: DefinitionActionDeps) => DefinitionUseCase,
): Promise<void> => {
  const action = make({
    definitions: convexPuzzleDefinitionRepository(ctx),
    events: noopEventPublisher(),
    clock: systemClock,
  });
  const result = await action({
    puzzleDefinitionId: toId<"PuzzleDefinitionId">(puzzleDefinitionId),
  });
  if (result.isErr) throw toConvexError(result.error);
};
