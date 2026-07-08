import {
  CatalogCategoryId,
  ChangeProposalId,
  PuzzleDefinitionId,
} from "../../../domain";

// Outbound port: minting new Catalog ids. The aggregates' `submit`/`create` take their id as
// input (they are pure and do no I/O), so the use case obtains one here. The Phase-2c adapter
// can back this with a pre-inserted document id or a uuid.
export interface CatalogIdGenerator {
  nextPuzzleDefinitionId(): PuzzleDefinitionId;
  nextCatalogCategoryId(): CatalogCategoryId;
  nextChangeProposalId(): ChangeProposalId;
}
