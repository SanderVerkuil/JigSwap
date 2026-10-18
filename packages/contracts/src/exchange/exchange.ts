import { z } from "zod";
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
}

/** One review the trade partner RECEIVED, as shown on the trade card. */
export interface TradePartnerReviewView {
  rating: number;
  comment?: string;
  createdAt: number;
  /** The reviewer's display name; absent when the reviewer is anonymous to the viewer. */
  reviewerName?: string;
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
 * EMAIL: the requester's email always reaches the owner (the requester consented by sending the
 * request). The owner's email reaches the requester only once the owner accepted or replied in THIS
 * exchange — even when the owner's profile is public, so proposing can't harvest emails.
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
      email?: string;
      profileViewable: boolean;
      reviews: {
        averageRating: number;
        totalReviews: number;
        /** Newest first, at most 10. */
        items: TradePartnerReviewView[];
      };
    };

/**
 * Platform exchange counters (legacy `getExchangeStats`). Status buckets mirror the legacy keys
 * exactly (`rejected`, not `declined`).
 */
export const exchangeStatsView = z.object({
  total: z.number(),
  proposed: z.number(),
  accepted: z.number(),
  completed: z.number(),
  rejected: z.number(),
  cancelled: z.number(),
});

export type ExchangeStatsView = z.infer<typeof exchangeStatsView>;

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
