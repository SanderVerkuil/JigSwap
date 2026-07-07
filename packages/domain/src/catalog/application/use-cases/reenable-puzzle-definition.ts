import { ReenablePuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeReenablePuzzleDefinition = (
  deps: DefinitionActionDeps,
): ReenablePuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) =>
    definition.reenable(now),
  );
  return (cmd) => run(cmd.puzzleDefinitionId);
};
