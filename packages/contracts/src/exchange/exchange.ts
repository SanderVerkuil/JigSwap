import type { MemberView } from "../identity/member";
import type { ConvexSystemFields } from "../shared/convex";
import type {
  ExchangeOwnedPuzzleView,
  ExchangePuzzleView,
} from "./puzzleSnapshots";

export type ExchangeStatus =
  "proposed" | "accepted" | "completed" | "rejected" | "cancelled" | "disputed";

/**
 * The raw exchange document fields (the `exchanges` table). Every exchange view spreads these, so
 * the legacy `...exchange` spread is preserved verbatim (UI reads `_id`, `aggregateId`, `status`,
 * `createdAt`, etc.).
 *
 * PRIVACY: `initiatorId` / `recipientId` are OMITTED for a party whose state is "hidden" (a raw id
 * is itself a leak); the matching `requester` / `owner` is then null. The viewer's own id is always
 * present. In practice only the owner (recipient) can be hidden, from the requester, until the
 * owner accepts or replies in this trade. See {@link ExchangePartyState}.
 */
export interface ExchangeFields extends ConvexSystemFields {
  aggregateId?: string;
  initiatorId?: string;
  recipientId?: string;
  type: "trade" | "sale" | "loan";
  offeredPuzzleId?: string;
  requestedPuzzleId: string;
  salePrice?: { amount: number; currency: string };
  loanReturnDate?: number;
  status: ExchangeStatus;
  initiatorConfirmationTimestamp?: number;
  recipientConfirmationTimestamp?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * How the viewer sees one party of an exchange, INSIDE that exchange only:
 * - "visible": the viewer themself, a public profile, or a mutual follower — full MemberView; the
 *   web may link their normal profile.
 * - "tradeRevealed": revealed by this trade only (the owner always sees the requester; the requester
 *   sees the owner once the owner accepted or replied). The MemberView is TRIMMED to `_id`,
 *   `_creationTime`, `name`, `username`, `isActive`, `createdAt`, `updatedAt` (no avatar, bio,
 *   location, preferredLanguage); this does NOT unlock their profile anywhere else, so don't link it.
 * - "hidden": a living member the viewer may not identify — MemberView null, raw id omitted.
 * - "departed": the account was deleted or deactivated — MemberView null (raw id kept).
 */
export type ExchangePartyState =
  "visible" | "tradeRevealed" | "hidden" | "departed";

/**
 * Single-exchange detail (legacy `getExchangeById`). The puzzle joins resolve to the OWNED copies
 * (the legacy names `ownerPuzzle`/`requesterPuzzle` were the requested/offered owned copies, not
 * the catalog definition); preserved verbatim.
 */
export interface ExchangeView extends ExchangeFields {
  /** null when hidden or departed; trimmed when tradeRevealed (see {@link ExchangePartyState}). */
  requester: MemberView | null;
  /** null when hidden or departed; trimmed when tradeRevealed (see {@link ExchangePartyState}). */
  owner: MemberView | null;
  requesterState: ExchangePartyState;
  ownerState: ExchangePartyState;
  ownerPuzzle: ExchangeOwnedPuzzleView | null;
  requesterPuzzle: ExchangeOwnedPuzzleView | null;
}

/**
 * A list-item exchange (legacy `getUserExchanges` / `getExchangesByOwner` / `getExchangesByRequester`).
 * Carries both the owned copies and their catalog definitions the legacy reads joined. `userRole`
 * is present only on the `getUserExchanges` variant (owner/requester lists omit it).
 */
export interface ExchangeSummaryView extends ExchangeFields {
  userRole?: "requester" | "owner";
  /** null when hidden or departed; trimmed when tradeRevealed (see {@link ExchangePartyState}). */
  requester: MemberView | null;
  /** null when hidden or departed; trimmed when tradeRevealed (see {@link ExchangePartyState}). */
  owner: MemberView | null;
  requesterState: ExchangePartyState;
  ownerState: ExchangePartyState;
  requestedOwnedPuzzle: ExchangeOwnedPuzzleView | null;
  requestedPuzzle: ExchangePuzzleView | null;
  offeredOwnedPuzzle: ExchangeOwnedPuzzleView | null;
  offeredPuzzle: ExchangePuzzleView | null;
  /**
   * Card cover of the requested copy, resolved like every library card (the copy's approved cover
   * photo, else the puzzle's box art): a URL, never a storage id. Null when there is none; absent
   * from backends that predate it.
   */
  requestedCoverUrl?: string | null;
  /** Card cover of the offered copy (swaps only), resolved like `requestedCoverUrl`. */
  offeredCoverUrl?: string | null;
  /**
   * Only on a COMPLETED lend: the loan its settlement opened, or null when none can be matched
   * (e.g. a lend settled before loans existed). A lend settles to "completed" while the puzzle is
   * still with the borrower, so this is what tells "on loan" from "returned". Absent on every other
   * exchange, and from backends that predate it.
   */
  loan?: ExchangeLoanState | null;
}

/** The loan a settled lend opened, as both parties of that lend see it on the exchange row. */
export interface ExchangeLoanState {
  status: "open" | "returned" | "recalled";
  /** Epoch millis the loan opened. */
  openedAt: number;
  /** Advisory expected-return epoch millis, if one was agreed. */
  expectedReturn?: number;
  /** Epoch millis the loan closed (returned or recalled), if it has. */
  closedAt?: number;
}

/** One review the trade partner RECEIVED, as shown on the trade card. */
export interface TradePartnerReviewView {
  rating: number;
  comment?: string;
  createdAt: number;
  /** The reviewer's display name; absent when the reviewer is anonymous to the viewer. */
  reviewerName?: string;
  /** The reviewer's account was deleted or deactivated (render "Deleted member"); never named. */
  reviewerDeparted?: true;
}

/**
 * The counterparty card of ONE exchange (`exchange.tradePartner`), for a party of that exchange.
 * - "hidden": a living member the viewer may not identify in this trade (the requester, before the
 *   owner accepted or replied). Nothing else is disclosed.
 * - "departed": the account was deleted or deactivated.
 * - "revealed": visible by the ordinary rules (public / mutual) OR revealed by this trade only.
 *   Carries ONLY the trade card: display name, handle, email (see below) and the reviews the member
 *   received. `profileViewable` is true only when the member is visible by the ordinary rules —
 *   link their normal profile only then.
 *
 * EMAIL: never part of a reveal. Each party's email reaches the other only after that party turned
 * on sharing in THIS exchange (`exchange.setContactSharing`), and only while the exchange is
 * accepted, completed or disputed with no block either way; it is hidden again after a cancel.
 * Requesting, replying or a public profile never share it, so proposing can't harvest emails.
 */
export type TradePartnerView =
  | { state: "hidden" }
  | { state: "departed" }
  | {
      state: "revealed";
      memberId: string;
      /** Display name (profile display name, else account name, else username). */
      name?: string;
      username?: string;
      /**
       * The partner's canonical `/members/<handle>` (slug, else a username that resolves back to
       * them, else their id; SEC-07): the handle to show on the card. Never show `username` as the
       * handle: another member may hold that string as a slug.
       */
      handle: string;
      /** Present only when the partner shared it with the viewer in this exchange (see above). */
      email?: string;
      /** The viewer's OWN email sharing in this exchange, for the switch on the card. */
      emailSharing: {
        /** The viewer turned on sharing their email with this partner. */
        youShare: boolean;
        /** Sharing can be turned on now (and a share is in effect): accepted, completed or
         * disputed, with no block either way. */
        open: boolean;
      };
      profileViewable: boolean;
      reviews: {
        averageRating: number;
        totalReviews: number;
        /** Newest first, at most 10. */
        items: TradePartnerReviewView[];
      };
    };

/** The sender summary embedded on a message (legacy joined `_id`/`name`/`avatar` only). */
export interface ExchangeMessageSenderView {
  _id: string;
  /** Already resolved (resolveMemberDisplayName, no email); absent = render the generic member label. */
  name?: string;
  avatar?: string;
}

/**
 * A conversation message on an exchange (legacy `getExchangeMessages`). Faithful superset of the
 * `messages` row plus the resolved `sender` summary; ordered oldest-first by the adapter.
 */
export interface ExchangeMessageView extends ConvexSystemFields {
  exchangeId: string;
  senderId: string;
  receiverId: string;
  content: string;
  messageType: "text" | "image" | "system";
  isRead: boolean;
  createdAt: number;
  sender: ExchangeMessageSenderView | null;
}
