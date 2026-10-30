import {
  ApprovalStatus,
  PuzzleDefinition,
  PuzzleDefinitionId,
} from "../../../domain";

// Which definitions a barcode lookup may return: only those in `statuses`, and never the one
// named by `excluding` (the definition being edited, which may keep its own barcodes).
export interface BarcodeHolderQuery {
  readonly statuses: readonly ApprovalStatus[];
  readonly excluding?: PuzzleDefinitionId;
}

// Outbound port: persistence for the PuzzleDefinition aggregate. The Phase-2c convex adapter
// implements this over `ctx.db` (the `puzzles` table) behind a mapper; the domain never sees a row.
export interface PuzzleDefinitionRepository {
  findById(id: PuzzleDefinitionId): Promise<PuzzleDefinition | null>;
  save(definition: PuzzleDefinition): Promise<void>;
  // Backs the barcode-uniqueness rule: returns a definition matching `query` that carries this
  // barcode, else null.
  findByBarcode(
    barcode: string,
    query: BarcodeHolderQuery,
  ): Promise<PuzzleDefinition | null>;
}
