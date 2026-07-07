import { DomainEvent } from "../../shared-kernel";
import { CatalogCategoryId, PuzzleDefinitionId, SubmitterId } from "./ids";

// All Catalog domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: the aggregate records them; an outbound publisher (Phase 2c) serialises
// and dispatches them to subscribers (Library, Social, Insights, Notifications).

export class PuzzleDefinitionSubmitted implements DomainEvent {
  readonly name = "PuzzleDefinitionSubmitted";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly submittedBy: SubmitterId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleDefinitionApproved implements DomainEvent {
  readonly name = "PuzzleDefinitionApproved";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleDefinitionRejected implements DomainEvent {
  readonly name = "PuzzleDefinitionRejected";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleDefinitionUpdated implements DomainEvent {
  readonly name = "PuzzleDefinitionUpdated";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

// Reversible admin lifecycle: a disabled definition is hidden from public browse/search but
// never deleted. No actor on the event — the acting admin is stamped at the composition root
// (moderationActions), same as approve/reject.
export class PuzzleDefinitionDisabled implements DomainEvent {
  readonly name = "PuzzleDefinitionDisabled";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleDefinitionReenabled implements DomainEvent {
  readonly name = "PuzzleDefinitionReenabled";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class CatalogCategoryCreated implements DomainEvent {
  readonly name = "CatalogCategoryCreated";
  constructor(
    readonly catalogCategoryId: CatalogCategoryId,
    readonly occurredAt: Date,
  ) {}
}

export class CatalogCategoryUpdated implements DomainEvent {
  readonly name = "CatalogCategoryUpdated";
  constructor(
    readonly catalogCategoryId: CatalogCategoryId,
    readonly occurredAt: Date,
  ) {}
}

// Soft-deactivation toggle: the taxonomy is never deleted, only made (in)active.
export class CatalogCategoryActiveChanged implements DomainEvent {
  readonly name = "CatalogCategoryActiveChanged";
  constructor(
    readonly catalogCategoryId: CatalogCategoryId,
    readonly isActive: boolean,
    readonly occurredAt: Date,
  ) {}
}

export class CatalogCategoryReordered implements DomainEvent {
  readonly name = "CatalogCategoryReordered";
  constructor(
    readonly catalogCategoryId: CatalogCategoryId,
    readonly sortOrder: number,
    readonly occurredAt: Date,
  ) {}
}

export type CatalogDomainEvent =
  | PuzzleDefinitionSubmitted
  | PuzzleDefinitionApproved
  | PuzzleDefinitionRejected
  | PuzzleDefinitionUpdated
  | PuzzleDefinitionDisabled
  | PuzzleDefinitionReenabled
  | CatalogCategoryCreated
  | CatalogCategoryUpdated
  | CatalogCategoryActiveChanged
  | CatalogCategoryReordered;
