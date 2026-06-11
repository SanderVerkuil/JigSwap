import { CatalogCategory, CatalogCategoryId } from "../../../domain";

// Outbound port: persistence for the CatalogCategory aggregate. Phase-2c implements this over
// the `adminCategories` table. `listActive` backs the public taxonomy query (active, in order).
export interface CatalogCategoryRepository {
  findById(id: CatalogCategoryId): Promise<CatalogCategory | null>;
  save(category: CatalogCategory): Promise<void>;
  listActive(): Promise<readonly CatalogCategory[]>;
}
