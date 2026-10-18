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

// --- Per-trade reveal (supersedes the pair-wide grants above) ---
// A reveal applies ONLY inside the one trade: its views, notifications and conversation. It never
// unlocks the member's profile, collection or activity elsewhere, and exposes only a limited card
// (name, handle, email, reviews received). The owner always sees the requester inside the trade
// (derived: the requester asked); the requester sees the owner inside the trade once the OWNER
// acted on it (recorded once per trade with the reason below).

/** Why the owner is revealed inside a trade; null = this trigger reveals nothing. */
export type TradeRevealReason = "accepted" | "owner_replied";

export const tradeRevealReasonFor = (
  trigger: ExchangeRevealTrigger,
  recipient: MemberId,
): TradeRevealReason | null => {
  switch (trigger.kind) {
    case "ExchangeAccepted":
      return "accepted";
    case "ExchangeMessagePosted":
      return trigger.authorId === recipient ? "owner_replied" : null;
    case "ExchangeProposed":
      return null;
  }
};

/**
 * How `viewer` sees `party` inside ONE trade:
 *   - self: the viewer is the party.
 *   - departed: the party's account is gone or deactivated.
 *   - visible: revealed by the ordinary rules (public profile / mutual followers) — full identity.
 *   - tradeRevealed: not visible, but revealed inside this trade only (limited card).
 *   - hidden: otherwise.
 */
export type TradePartyState =
  "self" | "visible" | "tradeRevealed" | "hidden" | "departed";

export interface TradeParties {
  readonly viewer: MemberId;
  readonly party: MemberId;
  readonly initiator: MemberId;
  readonly recipient: MemberId;
  /** The owner acted on THIS trade (accepted or replied). */
  readonly ownerActed: boolean;
}

export interface TradePartyFacts extends TradeParties {
  /** The party's account exists and is active. */
  readonly partyActive: boolean;
  /** The party is visible to the viewer by the ordinary rules (public profile / mutual). */
  readonly partyVisible: boolean;
}

/** Inside this trade, does the viewer get the party's limited card? (Ignores visibility rules.) */
const revealedInTrade = (t: TradeParties): boolean =>
  (t.viewer === t.recipient && t.party === t.initiator) ||
  (t.viewer === t.initiator && t.party === t.recipient && t.ownerActed);

export const tradePartyState = (facts: TradePartyFacts): TradePartyState => {
  if (facts.party === facts.viewer) return "self";
  if (!facts.partyActive) return "departed";
  if (facts.partyVisible) return "visible";
  return revealedInTrade(facts) ? "tradeRevealed" : "hidden";
};

/**
 * May the viewer see the party's email inside this trade? Only through the trade itself, never via
 * profile visibility: the requester's email reaches the owner (the requester consented by sending
 * the request); the owner's email reaches the requester only once the owner acted — otherwise
 * proposing to public owners would harvest their emails.
 */
export const tradeEmailVisible = (t: TradeParties): boolean =>
  t.party !== t.viewer && revealedInTrade(t);
