import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { CatalogError } from "./errors";
import {
  CatalogCategoryActiveChanged,
  CatalogCategoryCreated,
  CatalogCategoryReordered,
  CatalogCategoryUpdated,
} from "./events";
import { CatalogCategoryId } from "./ids";

// Localized text for the bilingual (en/nl) global taxonomy, mirroring the `adminCategories`
// `name`/`description` object columns.
export interface LocalizedText {
  readonly en: string;
  readonly nl: string;
}

// Input to create(): localized name plus optional presentation/order.
export interface CreateCatalogCategoryProps {
  readonly id: CatalogCategoryId;
  readonly name: LocalizedText;
  readonly sortOrder: number;
  readonly now: Date;
  readonly description?: LocalizedText;
  readonly color?: string;
}

// Patchable presentation fields; localized name/description replace wholesale when present.
export interface CatalogCategoryChanges {
  readonly name?: LocalizedText;
  readonly description?: LocalizedText;
  readonly color?: string;
}

// The persistable shape, kept close to the `adminCategories` columns for a trivial mapper.
export interface CatalogCategoryState {
  readonly id: CatalogCategoryId;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  readonly color?: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Every supported locale must be non-blank — a half-translated category is invalid.
const isNameComplete = (name: LocalizedText): boolean =>
  name.en.trim().length > 0 && name.nl.trim().length > 0;

export class CatalogCategory {
  private events: DomainEvent[] = [];

  private constructor(private state: CatalogCategoryState) {}

  get id(): CatalogCategoryId {
    return this.state.id;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  get sortOrder(): number {
    return this.state.sortOrder;
  }

  // Create a new taxonomy node. Starts active.
  static create(
    props: CreateCatalogCategoryProps,
  ): Result<CatalogCategory, CatalogError> {
    if (!isNameComplete(props.name))
      return err(CatalogError.emptyCategoryName());

    const state: CatalogCategoryState = {
      id: props.id,
      name: props.name,
      description: props.description,
      color: props.color,
      isActive: true,
      sortOrder: props.sortOrder,
      createdAt: props.now,
      updatedAt: props.now,
    };
    const category = new CatalogCategory(state);
    category.record(new CatalogCategoryCreated(state.id, props.now));
    return ok(category);
  }

  // Patch presentation fields; a replacement name must still be complete in every locale.
  update(
    changes: CatalogCategoryChanges,
    now: Date,
  ): Result<void, CatalogError> {
    if (changes.name !== undefined && !isNameComplete(changes.name)) {
      return err(CatalogError.emptyCategoryName());
    }
    this.state = {
      ...this.state,
      name: changes.name ?? this.state.name,
      description: changes.description ?? this.state.description,
      color: changes.color ?? this.state.color,
      updatedAt: now,
    };
    this.record(new CatalogCategoryUpdated(this.id, now));
    return ok(undefined);
  }

  // Soft-deactivate: the node is hidden but never deleted (preserves references). Idempotent.
  deactivate(now: Date): void {
    this.setActive(false, now);
  }

  activate(now: Date): void {
    this.setActive(true, now);
  }

  // Move the node to a new stable position in the taxonomy ordering. Idempotent.
  reorder(sortOrder: number, now: Date): void {
    if (this.state.sortOrder === sortOrder) return;
    this.state = { ...this.state, sortOrder, updatedAt: now };
    this.record(new CatalogCategoryReordered(this.id, sortOrder, now));
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: CatalogCategoryState): CatalogCategory {
    return new CatalogCategory(state);
  }

  toState(): CatalogCategoryState {
    return this.state;
  }

  // --- internals ---

  private setActive(isActive: boolean, now: Date): void {
    if (this.state.isActive === isActive) return;
    this.state = { ...this.state, isActive, updatedAt: now };
    this.record(new CatalogCategoryActiveChanged(this.id, isActive, now));
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
