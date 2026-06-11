import { OwnerId, PersonalCategory, PersonalCategoryId } from "../../../domain";

// Outbound port: persistence for the PersonalCategory aggregate (the `categories` table).
export interface PersonalCategoryRepository {
  findById(id: PersonalCategoryId): Promise<PersonalCategory | null>;
  save(category: PersonalCategory): Promise<void>;
  listByOwner(ownerId: OwnerId): Promise<readonly PersonalCategory[]>;
  findByOwnerAndName(
    ownerId: OwnerId,
    name: string,
  ): Promise<PersonalCategory | null>;
}
