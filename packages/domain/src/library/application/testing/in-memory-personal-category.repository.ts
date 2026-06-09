import { OwnerId, PersonalCategory, PersonalCategoryId } from "../../domain";
import { PersonalCategoryRepository } from "../ports/out/personal-category.repository";

// In-memory PersonalCategoryRepository for use-case tests.
export class InMemoryPersonalCategoryRepository implements PersonalCategoryRepository {
  private readonly store = new Map<
    PersonalCategoryId,
    ReturnType<PersonalCategory["toState"]>
  >();

  async findById(id: PersonalCategoryId): Promise<PersonalCategory | null> {
    const state = this.store.get(id);
    return state ? PersonalCategory.rehydrate(state) : null;
  }

  async save(category: PersonalCategory): Promise<void> {
    this.store.set(category.id, category.toState());
  }

  async listByOwner(ownerId: OwnerId): Promise<readonly PersonalCategory[]> {
    return [...this.store.values()]
      .filter((state) => state.ownerId === ownerId)
      .map((state) => PersonalCategory.rehydrate(state));
  }

  async findByOwnerAndName(
    ownerId: OwnerId,
    name: string,
  ): Promise<PersonalCategory | null> {
    for (const state of this.store.values()) {
      if (state.ownerId === ownerId && state.name === name) {
        return PersonalCategory.rehydrate(state);
      }
    }
    return null;
  }

  size(): number {
    return this.store.size;
  }
}
