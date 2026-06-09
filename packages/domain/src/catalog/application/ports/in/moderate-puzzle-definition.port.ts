import { Result } from "../../../../shared-kernel";
import { CatalogError, PuzzleDefinitionId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// Both moderation use cases (approve/reject) act on an existing definition by id; `now` comes
// from the Clock port, not the command. The aggregate enforces the legal approval transition.
export interface ModeratePuzzleDefinitionCommand {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
}

// Shared inbound-port signature: succeed with nothing, or fail with an aggregate error
// (illegal transition) or PuzzleDefinitionNotFound.
export type ModeratePuzzleDefinitionResult = Result<
  void,
  CatalogError | CatalogApplicationError
>;

export interface ApprovePuzzleDefinition {
  (cmd: ModeratePuzzleDefinitionCommand): Promise<ModeratePuzzleDefinitionResult>;
}

export interface RejectPuzzleDefinition {
  (cmd: ModeratePuzzleDefinitionCommand): Promise<ModeratePuzzleDefinitionResult>;
}
