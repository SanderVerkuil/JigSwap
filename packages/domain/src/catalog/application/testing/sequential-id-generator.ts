import { toId } from "../../../shared-kernel";
import { CatalogCategoryId, PuzzleDefinitionId } from "../../domain";
import { CatalogIdGenerator } from "../ports/out/catalog-id-generator";

// Deterministic CatalogIdGenerator for tests: pd-1, pd-2, … and cc-1, cc-2, …
export class SequentialIdGenerator implements CatalogIdGenerator {
  private definitionCounter = 0;
  private categoryCounter = 0;

  nextPuzzleDefinitionId(): PuzzleDefinitionId {
    this.definitionCounter += 1;
    return toId<"PuzzleDefinitionId">(`pd-${this.definitionCounter}`);
  }

  nextCatalogCategoryId(): CatalogCategoryId {
    this.categoryCounter += 1;
    return toId<"CatalogCategoryId">(`cc-${this.categoryCounter}`);
  }
}
