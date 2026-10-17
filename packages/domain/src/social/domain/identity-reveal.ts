import { MemberId } from "./ids";

// Trade identity reveal: an exchange must never let a party stay anonymous toward the
// counterparty, but the reveal is STAGED so that requesting can never unmask a private owner.
//   - Proposing reveals the REQUESTER (initiator) to the OWNER (recipient) immediately: the owner
//     must know who is asking before deciding.
//   - The OWNER is revealed to the requester only by the owner's OWN action — accepting, or posting
//     a member-authored message in that exchange's thread. A decline before any reply keeps the
//     owner anonymous.
// A reveal is a one-way grant (viewer -> target) that persists forever once made.

/** One directed identity grant: `viewer` may now see `target`'s real identity and profile. */
export interface IdentityReveal {
  readonly viewer: MemberId;
  readonly target: MemberId;
}

export interface ExchangeRevealProps {
  readonly initiator: MemberId;
  readonly recipient: MemberId;
  /** Whether the owner (recipient) has acted in this exchange (accepted / replied). */
  readonly ownerActed: boolean;
}

/**
 * The grants an exchange warrants. The owner always sees the requester; the requester sees the
 * owner iff the owner acted. A degenerate self-exchange (initiator === recipient) grants nothing.
 */
export const exchangeIdentityReveals = (
  props: ExchangeRevealProps,
): IdentityReveal[] => {
  if (props.initiator === props.recipient) return [];
  const reveals: IdentityReveal[] = [
    { viewer: props.recipient, target: props.initiator },
  ];
  if (props.ownerActed) {
    reveals.push({ viewer: props.initiator, target: props.recipient });
  }
  return reveals;
};

/** A live event that may change an exchange's reveals. */
export type ExchangeRevealTrigger =
  | { readonly kind: "ExchangeProposed" }
  | { readonly kind: "ExchangeAccepted" }
  // A message posted in the exchange's OWN thread; null author = a system/lifecycle message.
  | {
      readonly kind: "ExchangeMessagePosted";
      readonly authorId: MemberId | null;
    };

/**
 * Did this trigger come from the owner acting? Accepting always does; a thread message only when
 * the owner authored it (the requester's own messages and null-author system messages do not).
 * Proposing is the requester's action, never the owner's.
 */
export const ownerActedOnTrigger = (
  trigger: ExchangeRevealTrigger,
  recipient: MemberId,
): boolean => {
  switch (trigger.kind) {
    case "ExchangeAccepted":
      return true;
    case "ExchangeMessagePosted":
      return trigger.authorId === recipient;
    case "ExchangeProposed":
      return false;
  }
};

/** Statuses only reachable after the owner accepted. */
const POST_ACCEPT_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "completed",
  "disputed",
]);

/** What a historical exchange left behind, for reconstructing reveals of pre-existing trades. */
export interface ExchangeRevealHistory {
  readonly status: string;
  /** The owner authored at least one message in this exchange's thread (or legacy messages). */
  readonly ownerAuthoredMessage: boolean;
  /** The exchange's thread carries the "Exchange accepted" lifecycle system message. */
  readonly acceptedLifecycleMessage: boolean;
}

/**
 * Backfill rule: did the owner act on this historical exchange? A post-accept status proves it.
 * Otherwise (proposed / rejected / cancelled — cancelled is reachable from both proposed and
 * accepted, so status alone is ambiguous) only positive evidence counts. No evidence -> false:
 * FAIL CLOSED, the owner stays anonymous.
 */
export const ownerActedInHistory = (history: ExchangeRevealHistory): boolean =>
  POST_ACCEPT_STATUSES.has(history.status) ||
  history.ownerAuthoredMessage ||
  history.acceptedLifecycleMessage;
