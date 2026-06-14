import { DomainEvent } from "../../shared-kernel";
import { Condition } from "./condition";
import { CopyImageTag, FileId } from "./copy-image";
import {
  CollectionId,
  CopyId,
  LoanId,
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

// The copy's cover picture selection changed. `coverImageId` is the chosen `ownedPuzzleImages`
// id, or null to clear the selection (fall back to the puzzle's global catalogue image).
export class CopyCoverChanged implements DomainEvent {
  readonly name = "CopyCoverChanged";
  constructor(
    readonly copyId: CopyId,
    readonly coverImageId: string | null,
    readonly occurredAt: Date,
  ) {}
}

// Descriptive fields (missing-piece count, free-text notes) changed. Distinct from
// CopyConditionChanged so subscribers can treat grade changes and note edits differently.
export class CopyDetailsUpdated implements DomainEvent {
  readonly name = "CopyDetailsUpdated";
  constructor(
    readonly copyId: CopyId,
    readonly missingPiecesCount: number | undefined,
    readonly notes: string | undefined,
    readonly occurredAt: Date,
  ) {}
}

// Ownership of the (same) copy moved between members on exchange settlement. Carries both ends
// so a provenance/chain-of-custody read model can record the link without re-reading prior state.
export class CopyOwnershipTransferred implements DomainEvent {
  readonly name = "CopyOwnershipTransferred";
  constructor(
    readonly copyId: CopyId,
    readonly previousOwner: OwnerId,
    readonly newOwner: OwnerId,
    readonly occurredAt: Date,
  ) {}
}

// Possession (not ownership) of a copy moved to a borrower for the duration of a loan. The owner
// is unchanged; a subscriber flips availability and surfaces the "borrowed/lent" state.
export class CopyLentOut implements DomainEvent {
  readonly name = "CopyLentOut";
  constructor(
    readonly copyId: CopyId,
    readonly borrowerId: OwnerId,
    readonly occurredAt: Date,
  ) {}
}

// Possession returned to the owner (loan ended by return or recall).
export class CopyReturnedToOwner implements DomainEvent {
  readonly name = "CopyReturnedToOwner";
  constructor(
    readonly copyId: CopyId,
    readonly occurredAt: Date,
  ) {}
}

// A Loan was opened: possession of the copy passes to the borrower, open-ended (an expectedReturn
// is advisory, not enforced). The loan history read model folds these.
export class LoanOpened implements DomainEvent {
  readonly name = "LoanOpened";
  constructor(
    readonly loanId: LoanId,
    readonly copyId: CopyId,
    readonly lenderId: OwnerId,
    readonly borrowerId: OwnerId,
    readonly expectedReturn: Date | undefined,
    readonly occurredAt: Date,
  ) {}
}

// A Loan ended — `returned` by the borrower or `recalled` by the owner. Possession is the owner's.
export class LoanClosed implements DomainEvent {
  readonly name = "LoanClosed";
  constructor(
    readonly loanId: LoanId,
    readonly copyId: CopyId,
    readonly lenderId: OwnerId,
    readonly borrowerId: OwnerId,
    readonly reason: "returned" | "recalled",
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
  | CopyCoverChanged
  | CopyDetailsUpdated
  | CopyOwnershipTransferred
  | CopyLentOut
  | CopyReturnedToOwner
  | LoanOpened
  | LoanClosed
  | CopyDeleted
  | CollectionUpdated
  | CollectionCreated
  | CopyAddedToCollection
  | CopyRemovedFromCollection
  | PuzzleWished
  | PuzzleUnwished
  | CollectionDeleted
  | PersonalCategoryCreated;
