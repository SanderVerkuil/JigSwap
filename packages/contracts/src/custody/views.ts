// Chain-of-Custody read-model view DTOs: the typed shape the gateway's `custody.timeline` read
// returns. A Copy's provenance is the original owner, each recorded OwnershipTransfer (with the
// settling exchange + when), and the current owner — derived from the OwnershipTransferred events
// projected per copy. Ids are surfaced as opaque strings (the web app re-casts at the edge).

import type { MemberView } from "../identity/member";

/** A single ownership transfer in a Copy's provenance: who it went to, via which exchange, when. */
export interface CustodyTransferView {
  /** The settling Exchange aggregateId (domain ExchangeId). */
  exchangeId: string;
  /** The member the Copy was transferred to. Null if the user row no longer resolves. */
  newOwner: MemberView | null;
  /** Epoch millis the transfer occurred (settlement time). */
  occurredAt: number;
}

/**
 * A Copy's full chain of custody, chronological: the original owner, every transfer in order, and
 * the current owner. `transfers` is ascending by `occurredAt`. Returned by `custody.timeline`.
 */
export interface CopyCustodyTimelineView {
  /** The Copy this provenance belongs to (the `ownedPuzzles` _id). */
  copyId: string;
  /** The member who first held the Copy (its creator/owner). Null if unresolved. */
  originalOwner: MemberView | null;
  /** Ordered transfers (ascending by time). Empty when the Copy was never transferred. */
  transfers: CustodyTransferView[];
  /** The member who currently holds the Copy. Null if unresolved. */
  currentOwner: MemberView | null;
}
