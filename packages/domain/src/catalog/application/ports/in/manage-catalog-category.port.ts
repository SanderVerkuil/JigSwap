import { Result } from "../../../../shared-kernel";
import {
  CatalogCategoryChanges,
  CatalogCategoryId,
  CatalogError,
  LocalizedText,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// Create a new taxonomy node.
export interface CreateCatalogCategoryCommand {
  readonly name: LocalizedText;
  readonly sortOrder: number;
  readonly description?: LocalizedText;
  readonly color?: string;
}

export interface CreateCatalogCategory {
  (
    cmd: CreateCatalogCategoryCommand,
  ): Promise<Result<CatalogCategoryId, CatalogError | CatalogApplicationError>>;
}

// Patch a node's presentation fields.
export interface UpdateCatalogCategoryCommand {
  readonly catalogCategoryId: CatalogCategoryId;
  readonly changes: CatalogCategoryChanges;
}

export interface UpdateCatalogCategory {
  (
    cmd: UpdateCatalogCategoryCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}

// Soft (de)activation toggle — never a delete.
export interface SetCatalogCategoryActiveCommand {
  readonly catalogCategoryId: CatalogCategoryId;
  readonly isActive: boolean;
}

export interface SetCatalogCategoryActive {
  (
    cmd: SetCatalogCategoryActiveCommand,
  ): Promise<Result<void, CatalogApplicationError>>;
}

// Reorder several nodes at once (each id mapped to its new stable position).
export interface ReorderCatalogCategoriesCommand {
  readonly order: readonly { readonly catalogCategoryId: CatalogCategoryId; readonly sortOrder: number }[];
}

export interface ReorderCatalogCategories {
  (
    cmd: ReorderCatalogCategoriesCommand,
  ): Promise<Result<void, CatalogApplicationError>>;
}
