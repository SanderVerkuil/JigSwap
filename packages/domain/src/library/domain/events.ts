import { DomainEvent } from "../../shared-kernel";
import { Condition } from "./condition";
import { CopyImageTag, FileId } from "./copy-image";
import {
  CollectionId,
  CopyId,
  OwnerId,
  PersonalCategoryId,
  PuzzleDefinitionId,
} from "./ids";

// All Library domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: an aggregate records them; an outbound publisher (2c) serialises and
// dispatches them to subscribers (Reputation, Notifications, Insights).

export class CopyAcquired implements DomainEvent {
  readonly name = "CopyAcquired";
  constructor(
    readonly copyId: CopyId,
    readonly ownerId: OwnerId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly condition: Condition,
    readonly occurredAt: Date,
  ) {}
}

// Condition changes are append-friendly (feeds a future condition timeline): each carries
// the from/to grades.
export class CopyConditionChanged implements DomainEvent {
  readonly name = "CopyConditionChanged";
  constructor(
    readonly copyId: CopyId,
    readonly from: Condition,
    readonly to: Condition,
    readonly occurredAt: Date,
  ) {}
}

export class CopyMadeAvailable implements DomainEvent {
  readonly name = "CopyMadeAvailable";
  constructor(
    readonly copyId: CopyId,
    readonly forTrade: boolean,
    readonly forSale: boolean,
    readonly forLend: boolean,
    readonly occurredAt: Date,
  ) {}
}

export class CopyMadeUnavailable implements DomainEvent {
  readonly name = "CopyMadeUnavailable";
  constructor(
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

export class CopyImageAdded implements DomainEvent {
  readonly name = "CopyImageAdded";
  constructor(
    readonly copyId: CopyId,
    readonly fileId: FileId,
    readonly tag: CopyImageTag | undefined,
    readonly occurredAt: Date,
  ) {}
}

// The copy was removed from the owner's library. Carries no payload beyond identity so future
// subscribers (read models, Exchange reconciliation) can react to the removal.
export class CopyDeleted implements DomainEvent {
  readonly name = "CopyDeleted";
  constructor(
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

// Mutable fields of a collection (name/description/visibility/style/notes) were patched. Name
// uniqueness across the owner is an application concern, so this event makes no uniqueness claim.
export class CollectionUpdated implements DomainEvent {
  readonly name = "CollectionUpdated";
  constructor(
    readonly collectionId: CollectionId,
    readonly occurredAt: Date,
  ) {}
}

export class CollectionCreated implements DomainEvent {
  readonly name = "CollectionCreated";
  constructor(
    readonly collectionId: CollectionId,
    readonly ownerId: OwnerId,
    readonly collectionName: string,
    readonly isWishlist: boolean,
    readonly occurredAt: Date,
  ) {}
}

export class CopyAddedToCollection implements DomainEvent {
  readonly name = "CopyAddedToCollection";
  constructor(
    readonly collectionId: CollectionId,
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

export class CopyRemovedFromCollection implements DomainEvent {
  readonly name = "CopyRemovedFromCollection";
  constructor(
    readonly collectionId: CollectionId,
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

// A wishlist references desired PuzzleDefinitionIds rather than owned CopyIds.
export class PuzzleWished implements DomainEvent {
  readonly name = "PuzzleWished";
  constructor(
    readonly collectionId: CollectionId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleUnwished implements DomainEvent {
  readonly name = "PuzzleUnwished";
  constructor(
    readonly collectionId: CollectionId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class CollectionDeleted implements DomainEvent {
  readonly name = "CollectionDeleted";
  constructor(
    readonly collectionId: CollectionId,
    readonly occurredAt: Date,
  ) {}
}

export class PersonalCategoryCreated implements DomainEvent {
  readonly name = "PersonalCategoryCreated";
  constructor(
    readonly categoryId: PersonalCategoryId,
    readonly ownerId: OwnerId,
    readonly categoryName: string,
    readonly occurredAt: Date,
  ) {}
}

export type LibraryDomainEvent =
  | CopyAcquired
  | CopyConditionChanged
  | CopyMadeAvailable
  | CopyMadeUnavailable
  | CopyImageAdded
  | CopyDeleted
  | CollectionUpdated
  | CollectionCreated
  | CopyAddedToCollection
  | CopyRemovedFromCollection
  | PuzzleWished
  | PuzzleUnwished
  | CollectionDeleted
  | PersonalCategoryCreated;
