import { Result } from "../../../../shared-kernel";
import {
  CatalogError,
  PuzzleDefinitionChanges,
  PuzzleDefinitionId,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to patch a definition's descriptive fields.
export interface UpdatePuzzleDefinitionCommand {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly changes: PuzzleDefinitionChanges;
}

// Inbound port: the update-puzzle-definition use case.
export interface UpdatePuzzleDefinition {
  (
    cmd: UpdatePuzzleDefinitionCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}
