import { Result } from "../../../../shared-kernel";
import { PuzzleImportDraft, StorePageFetchError } from "../../../domain";
import { PuzzleMatch } from "../out/puzzle-match-lookup";

export interface ImportPuzzleFromUrlCommand {
  readonly url: string;
}

export interface PuzzleImportResult {
  readonly draft: PuzzleImportDraft;
  readonly match: PuzzleMatch | null;
  // True when the draft was served from the scrape cache rather than a fresh fetch. Diagnostic
  // only (e.g. for wide-event logging); callers that just want the draft can ignore it.
  readonly cached: boolean;
}

export interface ImportPuzzleFromUrl {
  (
    cmd: ImportPuzzleFromUrlCommand,
  ): Promise<Result<PuzzleImportResult, StorePageFetchError>>;
}
