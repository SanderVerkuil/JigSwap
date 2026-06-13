import { Result } from "../../../../shared-kernel";
import { PuzzleImportDraft, StorePageFetchError } from "../../../domain";
import { PuzzleMatch } from "../out/puzzle-match-lookup";

export interface ImportPuzzleFromUrlCommand {
  readonly url: string;
}

export interface PuzzleImportResult {
  readonly draft: PuzzleImportDraft;
  readonly match: PuzzleMatch | null;
}

export interface ImportPuzzleFromUrl {
  (
    cmd: ImportPuzzleFromUrlCommand,
  ): Promise<Result<PuzzleImportResult, StorePageFetchError>>;
}
