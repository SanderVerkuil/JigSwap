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
  CopyImageAdded,
  CopyMadeAvailable,
  CopyMadeUnavailable,
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
