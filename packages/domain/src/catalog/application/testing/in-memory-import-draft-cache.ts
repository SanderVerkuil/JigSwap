import { PuzzleImportDraft } from "../../domain";
import { CachedImportDraft, ImportDraftCache } from "../ports/out/import-draft-cache";

export class InMemoryImportDraftCache implements ImportDraftCache {
  private store = new Map<string, CachedImportDraft>();

  seed(url: string, draft: PuzzleImportDraft, fetchedAt: Date): void {
    this.store.set(url, { draft, fetchedAt });
  }

  async get(normalizedUrl: string): Promise<CachedImportDraft | null> {
    return this.store.get(normalizedUrl) ?? null;
  }
  async put(normalizedUrl: string, draft: PuzzleImportDraft): Promise<void> {
    this.store.set(normalizedUrl, { draft, fetchedAt: new Date() });
  }
}
