import { MemberId } from "./ids";

// Per-trade identity reveal. A reveal applies ONLY inside the one trade: its views, notifications and conversation. It never
// unlocks the member's profile, collection or activity elsewhere, and exposes only a limited card
// (name, handle, reviews received). The owner always sees the requester inside the trade
// (derived: the requester asked); the requester sees the owner inside the trade once the OWNER
// acted on it (recorded once per trade with the reason below). Requesting can therefore never
// unmask a private owner: the owner is revealed only by their own action.
//
// A member's EMAIL is never part of a reveal: requesting, replying and accepting share none. Each
// party's email reaches the other only after that party explicitly chose to share it in this trade,
// and only while the trade is accepted, completed or disputed (tradeEmailVisible).

/** A live event that may reveal the owner inside its trade. */
export type ExchangeRevealTrigger =
  | { readonly kind: "ExchangeProposed" }
  | { readonly kind: "ExchangeAccepted" }
  // A message posted in the exchange's OWN thread; null author = a system/lifecycle message.
  | {
      readonly kind: "ExchangeMessagePosted";
      readonly authorId: MemberId | null;
    };

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

/** Statuses only reachable after the owner accepted. */
const POST_ACCEPT_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "completed",
  "disputed",
]);

/** What a historical exchange left behind, for reconstructing the reveal of a pre-existing trade. */
export interface ExchangeRevealHistory {
  readonly status: string;
  /** The owner authored at least one message in this exchange's thread (or legacy chat). */
  readonly ownerAuthoredMessage: boolean;
  /** The exchange's thread carries the "Exchange accepted" lifecycle system message. */
  readonly acceptedLifecycleMessage: boolean;
}

/**
 * Backfill rule: did the owner act on this historical exchange, and how? A post-accept status or
 * the acceptance lifecycle message -> "accepted"; otherwise an owner-authored message ->
 * "owner_replied" (cancelled is reachable from both proposed and accepted, so status alone is
 * ambiguous). No evidence -> null: FAIL CLOSED, the owner stays hidden.
 */
export const tradeRevealReasonFromHistory = (
  history: ExchangeRevealHistory,
): TradeRevealReason | null => {
  if (
    POST_ACCEPT_STATUSES.has(history.status) ||
    history.acceptedLifecycleMessage
  ) {
    return "accepted";
  }
  return history.ownerAuthoredMessage ? "owner_replied" : null;
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
 * May a party share their email with the other party in this trade? Only once the owner accepted
 * (accepted, completed, disputed): never before, never after a decline or cancel, and never while
 * either party blocks the other.
 */
export const tradeContactSharingOpen = (t: {
  readonly status: string;
  readonly blocked: boolean;
}): boolean => !t.blocked && POST_ACCEPT_STATUSES.has(t.status);

export interface TradeEmailFacts {
  readonly viewer: MemberId;
  /** The other party of the trade, whose email is in question. */
  readonly party: MemberId;
  /** The trade's current status. */
  readonly status: string;
  /** The party turned on sharing their email in THIS trade. */
  readonly partyShared: boolean;
  /** Either party blocks the other. */
  readonly blocked: boolean;
}

/**
 * May the viewer see the party's email inside this trade? Only by the party's own explicit share,
 * and only while sharing is open (tradeContactSharingOpen). Never by requesting, replying or
 * accepting, never through profile visibility, and hidden again once the trade is declined or
 * cancelled; otherwise proposing (and any one-line reply) would harvest members' emails.
 */
export const tradeEmailVisible = (t: TradeEmailFacts): boolean =>
  t.party !== t.viewer && t.partyShared && tradeContactSharingOpen(t);
