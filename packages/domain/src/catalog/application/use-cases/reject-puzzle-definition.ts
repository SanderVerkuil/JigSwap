import { RejectPuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeRejectPuzzleDefinition =
  (deps: DefinitionActionDeps): RejectPuzzleDefinition =>
  (cmd) =>
    runDefinitionAction(deps, (definition, now) =>
      definition.reject(cmd.reason, now),
    )(cmd.puzzleDefinitionId);
