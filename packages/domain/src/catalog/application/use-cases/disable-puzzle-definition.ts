import { DisablePuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeDisablePuzzleDefinition = (
  deps: DefinitionActionDeps,
): DisablePuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) =>
    definition.disable(now),
  );
  return (cmd) => run(cmd.puzzleDefinitionId);
};
