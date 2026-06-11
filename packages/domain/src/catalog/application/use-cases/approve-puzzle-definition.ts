import { ApprovePuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeApprovePuzzleDefinition = (
  deps: DefinitionActionDeps,
): ApprovePuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) =>
    definition.approve(now),
  );
  return (cmd) => run(cmd.puzzleDefinitionId);
};
