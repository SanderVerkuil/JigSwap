import { DomainEvent, ok, Result } from "../../shared-kernel";
import { Acquisition } from "./acquisition";
import { CatalogSnapshot } from "./catalog-snapshot";
import { Condition } from "./condition";
import { CopyImage } from "./copy-image";
import { LibraryError } from "./errors";
import {
  CopyAcquired,
  CopyConditionChanged,
  CopyDeleted,
  CopyDetailsUpdated,
  CopyImageAdded,
  CopyLentOut,
  CopyMadeAvailable,
  CopyMadeUnavailable,
  CopyOwnershipTransferred,
  CopyReturnedToOwner,
} from "./events";
import { CopyId, OwnerId, PuzzleDefinitionId } from "./ids";
import { SharingSetting } from "./sharing-setting";

// Input to acquire(): a new copy of a known PuzzleDefinition, with its cached snapshot.
export interface AcquireCopyProps {
  readonly id: CopyId;
  readonly ownerId: OwnerId;
  readonly snapshot: CatalogSnapshot;
  readonly condition: Condition;
  readonly acquisition?: Acquisition;
  readonly missingPiecesCount?: number;
  readonly notes?: string;
  readonly now: Date;
}

// The persistable shape, kept close to the `ownedPuzzles` columns so the 2c mapper is a
// near field-for-field translation (puzzleId→puzzleDefinitionId, availability→SharingSetting,
// acquisition* → Acquisition) PLUS the cached snapshot fields (2c adds columns for these).
export interface CopyState {
  readonly id: CopyId;
  readonly ownerId: OwnerId;
  // Who physically holds the copy now — the owner, unless it is currently lent out to a borrower.
  // Ownership (ownerId) and possession (heldBy) diverge only for the duration of a loan.
  readonly heldBy: OwnerId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly snapshot: CatalogSnapshot;
  readonly condition: Condition;
  readonly missingPiecesCount?: number;
  readonly notes?: string;
  readonly sharing: SharingSetting;
  readonly acquisition: Acquisition;
  readonly images: readonly CopyImage[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// The Copy aggregate root: one physical instance of a PuzzleDefinition owned by a member.
// It references the definition by id and holds only a cached CatalogSnapshot (ACL); it never
// loads the Catalog aggregate.
//
// INVARIANT NOT ENFORCED HERE (application-layer concern via a port): a Copy "reserved by at
// most one active Exchange" cannot be made available. Reservation state lives in the Exchange
// context; the use case consults a port before calling makeAvailable. (proposal §1.4)
export class Copy {
  private events: DomainEvent[] = [];

  private constructor(private state: CopyState) {}

  get id(): CopyId {
    return this.state.id;
  }

  get ownerId(): OwnerId {
    return this.state.ownerId;
  }

  get heldBy(): OwnerId {
    return this.state.heldBy;
  }

  get condition(): Condition {
    return this.state.condition;
  }

  get sharing(): SharingSetting {
    return this.state.sharing;
  }

  // Mint a brand-new copy: owner, condition, acquisition, default (private) sharing; records
  // CopyAcquired. The snapshot is supplied by the application layer via the CatalogSnapshotProvider.
  static acquire(props: AcquireCopyProps): Result<Copy, LibraryError> {
    const state: CopyState = {
      id: props.id,
      ownerId: props.ownerId,
      heldBy: props.ownerId,
      puzzleDefinitionId: props.snapshot.puzzleDefinitionId,
      snapshot: props.snapshot,
      condition: props.condition,
      missingPiecesCount: props.missingPiecesCount,
      notes: props.notes,
      sharing: SharingSetting.private(),
      acquisition: props.acquisition ?? Acquisition.unknown(),
      images: [],
      createdAt: props.now,
      updatedAt: props.now,
    };
    const copy = new Copy(state);
    copy.record(
      new CopyAcquired(
        state.id,
        state.ownerId,
        state.puzzleDefinitionId,
        state.condition,
        props.now,
      ),
    );
    return ok(copy);
  }

  // Re-grade the copy. Append-friendly: emits a from/to event feeding a future condition
  // timeline. A no-op (same grade) records nothing.
  changeCondition(to: Condition, now: Date): Result<void, LibraryError> {
    const from = this.state.condition;
    if (from === to) return ok(undefined);
    this.state = { ...this.state, condition: to, updatedAt: now };
    this.record(new CopyConditionChanged(this.id, from, to, now));
    return ok(undefined);
  }

  // Replace the whole sharing setting. Emits CopyMadeAvailable/Unavailable so subscribers
  // (and the Exchange context's read model) can react to availability changes.
  updateSharing(
    setting: SharingSetting,
    now: Date,
  ): Result<void, LibraryError> {
    this.state = { ...this.state, sharing: setting, updatedAt: now };
    if (setting.isAvailableForAnyExchange()) {
      this.record(
        new CopyMadeAvailable(
          this.id,
          setting.forTrade,
          setting.forSale,
          setting.forLend,
          now,
        ),
      );
    } else {
      this.record(new CopyMadeUnavailable(this.id, now));
    }
    return ok(undefined);
  }

  // Settle an exchange: the SAME physical copy changes hands. Owner-scoped facts reset (sharing
  // back to private so the new owner decides availability; acquisition becomes a trade; personal
  // notes drop), while the physical record (condition, snapshot, missing pieces, images) carries
  // over. The stable copy id keeps the chain-of-custody coherent across successive owners.
  transferTo(newOwner: OwnerId, now: Date): Result<void, LibraryError> {
    const previousOwner = this.state.ownerId;
    this.state = {
      ...this.state,
      ownerId: newOwner,
      heldBy: newOwner,
      sharing: SharingSetting.private(),
      acquisition: Acquisition.create({ source: "trade", date: now }),
      notes: undefined,
      updatedAt: now,
    };
    this.record(
      new CopyOwnershipTransferred(this.id, previousOwner, newOwner, now),
    );
    return ok(undefined);
  }

  // Lend the copy out: possession passes to the borrower (ownership unchanged) and it leaves the
  // market for the loan's duration. Driven by the loan use case; the owner stays this.state.ownerId.
  lendOut(borrower: OwnerId, now: Date): Result<void, LibraryError> {
    this.state = {
      ...this.state,
      heldBy: borrower,
      sharing: SharingSetting.private(),
      updatedAt: now,
    };
    this.record(new CopyLentOut(this.id, borrower, now));
    return ok(undefined);
  }

  // End a loan: possession returns to the owner (it stays off the market until re-shared).
  returnToOwner(now: Date): Result<void, LibraryError> {
    this.state = {
      ...this.state,
      heldBy: this.state.ownerId,
      updatedAt: now,
    };
    this.record(new CopyReturnedToOwner(this.id, now));
    return ok(undefined);
  }

  // Patch the descriptive fields the condition/sharing methods don't cover. An undefined field
  // in `changes` leaves the current value untouched; only the supplied fields are overwritten.
  updateDetails(
    changes: {
      readonly missingPiecesCount?: number;
      readonly notes?: string;
    },
    now: Date,
  ): Result<void, LibraryError> {
    this.state = {
      ...this.state,
      missingPiecesCount:
        changes.missingPiecesCount ?? this.state.missingPiecesCount,
      notes: changes.notes ?? this.state.notes,
      updatedAt: now,
    };
    this.record(
      new CopyDetailsUpdated(
        this.id,
        this.state.missingPiecesCount,
        this.state.notes,
        now,
      ),
    );
    return ok(undefined);
  }

  // Mark the copy for removal. Deletion is the repository dropping the row; this records a
  // CopyDeleted event the use case publishes afterwards so subscribers can react.
  delete(now: Date): Result<void, LibraryError> {
    this.record(new CopyDeleted(this.id, now));
    return ok(undefined);
  }

  // Attach a photo. Images belong to the Copy (§1.4).
  addImage(image: CopyImage, now: Date): Result<void, LibraryError> {
    this.state = {
      ...this.state,
      images: [...this.state.images, image],
      updatedAt: now,
    };
    this.record(new CopyImageAdded(this.id, image.fileId, image.tag, now));
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: CopyState): Copy {
    return new Copy(state);
  }

  toState(): CopyState {
    return this.state;
  }

  // --- internals ---

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
