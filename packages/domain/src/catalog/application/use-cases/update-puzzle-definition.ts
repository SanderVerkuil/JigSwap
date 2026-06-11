import {
  UpdatePuzzleDefinition,
  UpdatePuzzleDefinitionCommand,
} from "../ports/in/update-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeUpdatePuzzleDefinition = (
  deps: DefinitionActionDeps,
): UpdatePuzzleDefinition => {
  return (cmd: UpdatePuzzleDefinitionCommand) =>
    runDefinitionAction(deps, (definition, now) =>
      definition.update(cmd.changes, now),
    )(cmd.puzzleDefinitionId);
};
