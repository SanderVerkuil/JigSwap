import { PuzzleDefinition, PuzzleDefinitionId } from "../../../domain";

// Outbound port: persistence for the PuzzleDefinition aggregate. The Phase-2c convex adapter
// implements this over `ctx.db` (the `puzzles` table) behind a mapper; the domain never sees a row.
export interface PuzzleDefinitionRepository {
  findById(id: PuzzleDefinitionId): Promise<PuzzleDefinition | null>;
  save(definition: PuzzleDefinition): Promise<void>;
  // Backs the barcode-uniqueness rule: returns any existing definition carrying this barcode.
  findByBarcode(barcode: string): Promise<PuzzleDefinition | null>;
}
