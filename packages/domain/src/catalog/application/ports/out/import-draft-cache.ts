import { PuzzleImportDraft } from "../../../domain";

export interface CachedImportDraft {
  readonly draft: PuzzleImportDraft;
  readonly fetchedAt: Date;
}

// Keyed on a normalized URL so repeated pastes of the same link skip re-fetching.
export interface ImportDraftCache {
  get(normalizedUrl: string): Promise<CachedImportDraft | null>;
  put(normalizedUrl: string, draft: PuzzleImportDraft): Promise<void>;
}
