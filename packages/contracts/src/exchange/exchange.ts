import { z } from "zod";
import type { MemberView } from "../identity/member";
import type { ConvexSystemFields } from "../shared/convex";
import type {
  ExchangeOwnedPuzzleView,
  ExchangePuzzleView,
} from "./puzzleSnapshots";

export type ExchangeStatus =
  | "proposed"
  | "accepted"
  | "completed"
  | "rejected"
  | "cancelled"
  | "disputed";

/**
 * The raw exchange document fields (the `exchanges` table). Every exchange view spreads these, so
 * the legacy `...exchange` spread is preserved verbatim (UI reads `_id`, `aggregateId`, `status`,
 * `createdAt`, etc.).
 */
export interface ExchangeFields extends ConvexSystemFields {
  aggregateId?: string;
  initiatorId: string;
  recipientId: string;
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
 * Single-exchange detail (legacy `getExchangeById`). The puzzle joins resolve to the OWNED copies
 * (the legacy names `ownerPuzzle`/`requesterPuzzle` were the requested/offered owned copies, not
 * the catalog definition); preserved verbatim.
 */
export interface ExchangeView extends ExchangeFields {
  requester: MemberView | null;
  owner: MemberView | null;
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
  requester: MemberView | null;
  owner: MemberView | null;
  requestedOwnedPuzzle: ExchangeOwnedPuzzleView | null;
  requestedPuzzle: ExchangePuzzleView | null;
  offeredOwnedPuzzle: ExchangeOwnedPuzzleView | null;
  offeredPuzzle: ExchangePuzzleView | null;
}

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
  name: string;
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
