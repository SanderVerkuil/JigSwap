import { CatalogCategory, CatalogCategoryId } from "../../domain";
import { CatalogCategoryRepository } from "../ports/out/catalog-category.repository";

// In-memory CatalogCategoryRepository for use-case tests. `listActive` returns active nodes in
// ascending sort order, as a real adapter's `by_sort_order` index query would.
export class InMemoryCatalogCategoryRepository implements CatalogCategoryRepository {
  private readonly store = new Map<
    CatalogCategoryId,
    ReturnType<CatalogCategory["toState"]>
  >();

  async findById(id: CatalogCategoryId): Promise<CatalogCategory | null> {
    const state = this.store.get(id);
    return state ? CatalogCategory.rehydrate(state) : null;
  }

  async save(category: CatalogCategory): Promise<void> {
    this.store.set(category.id, category.toState());
  }

  async listActive(): Promise<readonly CatalogCategory[]> {
    return [...this.store.values()]
      .filter((state) => state.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((state) => CatalogCategory.rehydrate(state));
  }

  // Test helper: how many categories are currently stored.
  size(): number {
    return this.store.size;
  }
}
