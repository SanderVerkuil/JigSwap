import { PuzzleDefinition, PuzzleDefinitionId } from "../../domain";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

// In-memory PuzzleDefinitionRepository for use-case tests. Stores persisted state and
// rehydrates a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryPuzzleDefinitionRepository implements PuzzleDefinitionRepository {
  private readonly store = new Map<
    PuzzleDefinitionId,
    ReturnType<PuzzleDefinition["toState"]>
  >();

  async findById(id: PuzzleDefinitionId): Promise<PuzzleDefinition | null> {
    const state = this.store.get(id);
    return state ? PuzzleDefinition.rehydrate(state) : null;
  }

  async save(definition: PuzzleDefinition): Promise<void> {
    this.store.set(definition.id, definition.toState());
  }

  async findByBarcode(barcode: string): Promise<PuzzleDefinition | null> {
    for (const state of this.store.values()) {
      if (state.ean === barcode || state.upc === barcode || state.modelNumber === barcode) {
        return PuzzleDefinition.rehydrate(state);
      }
    }
    return null;
  }

  // Test helper: how many definitions are currently stored.
  size(): number {
    return this.store.size;
  }
}
