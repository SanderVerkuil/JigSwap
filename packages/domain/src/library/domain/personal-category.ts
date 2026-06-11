import { DomainEvent, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";
import { PersonalCategoryCreated } from "./events";
import { OwnerId, PersonalCategoryId } from "./ids";

// A lightweight aggregate: a member's private label for organising collections. Matches the
// `categories` table. Homonym fix: this PersonalCategory ≠ Catalog's CatalogCategory (§1.5).
export interface CreatePersonalCategoryProps {
  readonly id: PersonalCategoryId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly color?: string;
  readonly description?: string;
  readonly isDefault?: boolean;
  readonly now: Date;
}

export interface PersonalCategoryState {
  readonly id: PersonalCategoryId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly color?: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PersonalCategory {
  private events: DomainEvent[] = [];

  private constructor(private state: PersonalCategoryState) {}

  get id(): PersonalCategoryId {
    return this.state.id;
  }

  get ownerId(): OwnerId {
    return this.state.ownerId;
  }

  get name(): string {
    return this.state.name;
  }

  static create(
    props: CreatePersonalCategoryProps,
  ): Result<PersonalCategory, LibraryError> {
    const state: PersonalCategoryState = {
      id: props.id,
      ownerId: props.ownerId,
      name: props.name,
      color: props.color,
      description: props.description,
      isDefault: props.isDefault ?? false,
      createdAt: props.now,
      updatedAt: props.now,
    };
    const category = new PersonalCategory(state);
    category.record(
      new PersonalCategoryCreated(
        state.id,
        state.ownerId,
        state.name,
        props.now,
      ),
    );
    return ok(category);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: PersonalCategoryState): PersonalCategory {
    return new PersonalCategory(state);
  }

  toState(): PersonalCategoryState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
