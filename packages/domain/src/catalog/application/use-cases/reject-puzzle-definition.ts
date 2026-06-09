import { RejectPuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import { DefinitionActionDeps, runDefinitionAction } from "./run-definition-action";

export const makeRejectPuzzleDefinition = (
  deps: DefinitionActionDeps,
): RejectPuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) => definition.reject(now));
  return (cmd) => run(cmd.puzzleDefinitionId);
};
