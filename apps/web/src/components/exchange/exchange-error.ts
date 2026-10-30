import { convexErrorCode } from "./request-trade";

// The exchange lifecycle mutations (accept, decline, complete, cancel) reject with
// `ConvexError<{ code, message }>`. These are the refusals the Exchanges page explains to the
// member, as keys under the `trades` namespace:
//   - NotPermittedInCircle: accept re-checks the requester's circle permission.
//   - CopyReserved: accept or complete while a puzzle in the deal is set aside for another accepted
//     exchange, or out on loan.
//   - RecipientNotOwner / OfferedCopyNotOwned / CopyNotFound: a puzzle in the deal changed hands
//     or is gone since it was proposed, so the deal can't settle any more.
export type ExchangeErrorKey =
  "acceptNotPermitted" | "errors.copyReserved" | "errors.copyChangedHands";

const CODE_TO_KEY = new Map<string, ExchangeErrorKey>([
  ["NotPermittedInCircle", "acceptNotPermitted"],
  ["CopyReserved", "errors.copyReserved"],
  ["RecipientNotOwner", "errors.copyChangedHands"],
  ["OfferedCopyNotOwned", "errors.copyChangedHands"],
  ["CopyNotFound", "errors.copyChangedHands"],
]);

/** The `trades` message key explaining an exchange action's refusal, else undefined. */
export const exchangeErrorKey = (
  error: unknown,
): ExchangeErrorKey | undefined =>
  CODE_TO_KEY.get(convexErrorCode(error) ?? "");
