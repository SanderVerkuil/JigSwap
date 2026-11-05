import { err } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  UpdatePuzzleDefinition,
  UpdatePuzzleDefinitionCommand,
} from "../ports/in/update-puzzle-definition.port";
import { firstDuplicateBarcode } from "./barcode-uniqueness";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

// Patch a definition. New barcodes must not be held by another definition (the same rule
// submit enforces); restating the definition's own barcodes is fine.
export const makeUpdatePuzzleDefinition = (
  deps: DefinitionActionDeps,
): UpdatePuzzleDefinition => {
  return async (cmd: UpdatePuzzleDefinitionCommand) => {
    const duplicate = await firstDuplicateBarcode(
      deps.definitions,
      cmd.changes.barcodes,
      cmd.puzzleDefinitionId,
    );
    if (duplicate)
      return err(CatalogApplicationError.duplicateBarcode(duplicate));

    return runDefinitionAction(deps, (definition, now) =>
      definition.update(cmd.changes, now),
    )(cmd.puzzleDefinitionId);
  };
};
