import type { ExchangeFields } from "@jigswap/contracts";

// Pure reads of an exchange from the viewer's seat. The exchange lists come per direction:
// incoming = the viewer owns the requested copy (the exchange's RECIPIENT), outgoing = the viewer
// asked for it (the INITIATOR). Completion needs both sides to confirm; the second confirmation
// settles the exchange (ownership or possession moves), the first only records a timestamp.

export type Direction = "incoming" | "outgoing";
export type ExchangeSide = "initiator" | "recipient";

type ConfirmationFields = Pick<
  ExchangeFields,
  "initiatorConfirmationTimestamp" | "recipientConfirmationTimestamp"
>;

export const viewerSide = (direction: Direction): ExchangeSide =>
  direction === "outgoing" ? "initiator" : "recipient";

export interface ConfirmationState {
  /** When the viewer confirmed completion, if they have. */
  mineAt?: number;
  /** When the partner confirmed completion, if they have. */
  theirsAt?: number;
  /** True when only the partner has confirmed, so the viewer's confirmation settles the exchange. */
  mySettles: boolean;
}

export const confirmationState = (
  exchange: ConfirmationFields,
  side: ExchangeSide,
): ConfirmationState => {
  const initiatorAt = exchange.initiatorConfirmationTimestamp;
  const recipientAt = exchange.recipientConfirmationTimestamp;
  const mineAt = side === "initiator" ? initiatorAt : recipientAt;
  const theirsAt = side === "initiator" ? recipientAt : initiatorAt;
  return {
    mineAt,
    theirsAt,
    mySettles: mineAt === undefined && theirsAt !== undefined,
  };
};

/**
 * Whether the exchange waits on the viewer: the owner answering a pending request, or either party
 * confirming an accepted exchange they haven't confirmed yet.
 */
export const needsViewerAction = (
  exchange: ConfirmationFields & Pick<ExchangeFields, "status">,
  direction: Direction,
): boolean => {
  if (exchange.status === "proposed") return direction === "incoming";
  if (exchange.status === "accepted") {
    return (
      confirmationState(exchange, viewerSide(direction)).mineAt === undefined
    );
  }
  return false;
};
