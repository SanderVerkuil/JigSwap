import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";
import {
  CollectionCreated,
  CollectionDeleted,
  CollectionUpdated,
  CopyAddedToCollection,
  CopyRemovedFromCollection,
  PuzzleUnwished,
  PuzzleWished,
} from "./events";
import { CollectionId, CopyId, OwnerId, PuzzleDefinitionId } from "./ids";

// A Collection's reach, matching the persisted `collections.visibility` column.
export type CollectionVisibility = "private" | "public";

// WISHLIST MODELLING DECISION: a Wishlist is a Collection VARIANT, not a separate aggregate.
// One aggregate keeps the "named grouping the owner organises" concept in a single place and
// matches the existing `collections` table. The variant is expressed by `isWishlist` plus a
// distinct member type: a regular collection references the owner's own CopyIds; a wishlist
// references desired PuzzleDefinitionIds (not owned). The two member sets never mix — the
// methods guard against adding the wrong kind (WrongMemberType).
export interface CreateCollectionProps {
  readonly id: CollectionId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly description?: string;
  readonly visibility?: CollectionVisibility;
  readonly color?: string;
  readonly icon?: string;
  readonly isDefault?: boolean;
  readonly isWishlist?: boolean;
  readonly personalNotes?: string;
  readonly now: Date;
}

// Persistable shape. `copyMembers` maps to `collectionMembers` rows; `wishedDefinitions` is
// the wishlist analogue (2c decides its storage). Uniqueness of (owner, name) is enforced in
// the application layer via the repository, not here.
export interface CollectionState {
  readonly id: CollectionId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly description?: string;
  readonly visibility: CollectionVisibility;
  readonly color?: string;
  readonly icon?: string;
  readonly isDefault: boolean;
  readonly isWishlist: boolean;
  readonly personalNotes?: string;
  readonly copyMembers: readonly CopyId[];
  readonly wishedDefinitions: readonly PuzzleDefinitionId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Collection {
  private events: DomainEvent[] = [];

  private constructor(private state: CollectionState) {}

  get id(): CollectionId {
    return this.state.id;
  }

  get ownerId(): OwnerId {
    return this.state.ownerId;
  }

  get name(): string {
    return this.state.name;
  }

  get isDefault(): boolean {
    return this.state.isDefault;
  }

  get isWishlist(): boolean {
    return this.state.isWishlist;
  }

  get copyMembers(): readonly CopyId[] {
    return this.state.copyMembers;
  }

  get wishedDefinitions(): readonly PuzzleDefinitionId[] {
    return this.state.wishedDefinitions;
  }

  static create(
    props: CreateCollectionProps,
  ): Result<Collection, LibraryError> {
    const isWishlist = props.isWishlist ?? false;
    const state: CollectionState = {
      id: props.id,
      ownerId: props.ownerId,
      name: props.name,
      description: props.description,
      visibility: props.visibility ?? "private",
      color: props.color,
      icon: props.icon,
      isDefault: props.isDefault ?? false,
      isWishlist,
      personalNotes: props.personalNotes,
      copyMembers: [],
      wishedDefinitions: [],
      createdAt: props.now,
      updatedAt: props.now,
    };
    const collection = new Collection(state);
    collection.record(
      new CollectionCreated(
        state.id,
        state.ownerId,
        state.name,
        isWishlist,
        props.now,
      ),
    );
    return ok(collection);
  }

  // Rename / re-describe / re-style. Name uniqueness across the owner's collections is an
  // application concern (needs the repository), checked before this is called.
  update(
    props: {
      readonly name?: string;
      readonly description?: string;
      readonly visibility?: CollectionVisibility;
      readonly color?: string;
      readonly icon?: string;
      readonly personalNotes?: string;
    },
    now: Date,
  ): Result<void, LibraryError> {
    this.state = {
      ...this.state,
      name: props.name ?? this.state.name,
      description: props.description ?? this.state.description,
      visibility: props.visibility ?? this.state.visibility,
      color: props.color ?? this.state.color,
      icon: props.icon ?? this.state.icon,
      personalNotes: props.personalNotes ?? this.state.personalNotes,
      updatedAt: now,
    };
    this.record(new CollectionUpdated(this.id, now));
    return ok(undefined);
  }

  // Add one of the owner's own copies. The "only the owner's own copies" rule needs the
  // Copy's ownerId and is enforced in the AddCopyToCollection use case; the aggregate guards
  // the structural rule (a wishlist holds definitions, not copies) and de-duplicates.
  addCopy(copyId: CopyId, now: Date): Result<void, LibraryError> {
    if (this.state.isWishlist) {
      return err(
        LibraryError.wrongMemberType(
          "A wishlist holds desired definitions, not copies",
        ),
      );
    }
    if (this.state.copyMembers.includes(copyId)) return ok(undefined);
    this.state = {
      ...this.state,
      copyMembers: [...this.state.copyMembers, copyId],
      updatedAt: now,
    };
    this.record(new CopyAddedToCollection(this.id, copyId, now));
    return ok(undefined);
  }

  removeCopy(copyId: CopyId, now: Date): Result<void, LibraryError> {
    if (!this.state.copyMembers.includes(copyId)) {
      return err(LibraryError.copyNotInCollection());
    }
    this.state = {
      ...this.state,
      copyMembers: this.state.copyMembers.filter((id) => id !== copyId),
      updatedAt: now,
    };
    this.record(new CopyRemovedFromCollection(this.id, copyId, now));
    return ok(undefined);
  }

  // Wishlist-only: add a desired (not owned) PuzzleDefinition.
  wishFor(
    definitionId: PuzzleDefinitionId,
    now: Date,
  ): Result<void, LibraryError> {
    if (!this.state.isWishlist) {
      return err(
        LibraryError.wrongMemberType(
          "Only a wishlist can reference desired definitions",
        ),
      );
    }
    if (this.state.wishedDefinitions.includes(definitionId))
      return ok(undefined);
    this.state = {
      ...this.state,
      wishedDefinitions: [...this.state.wishedDefinitions, definitionId],
      updatedAt: now,
    };
    this.record(new PuzzleWished(this.id, definitionId, now));
    return ok(undefined);
  }

  unwish(
    definitionId: PuzzleDefinitionId,
    now: Date,
  ): Result<void, LibraryError> {
    if (!this.state.wishedDefinitions.includes(definitionId)) {
      return err(LibraryError.copyNotInCollection());
    }
    this.state = {
      ...this.state,
      wishedDefinitions: this.state.wishedDefinitions.filter(
        (id) => id !== definitionId,
      ),
      updatedAt: now,
    };
    this.record(new PuzzleUnwished(this.id, definitionId, now));
    return ok(undefined);
  }

  // Invariant: a default (system) collection cannot be deleted. Returns the deletion event
  // for the use case to publish after the repository removes the row.
  delete(now: Date): Result<void, LibraryError> {
    if (this.state.isDefault) {
      return err(LibraryError.cannotDeleteDefaultCollection());
    }
    this.record(new CollectionDeleted(this.id, now));
    return ok(undefined);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: CollectionState): Collection {
    return new Collection(state);
  }

  toState(): CollectionState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
