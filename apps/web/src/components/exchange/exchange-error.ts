import { convexErrorCode } from "./request-trade";

// The exchange lifecycle mutations (accept, decline, cancel, confirm completion) and the loan
// mutations (return, recall) reject with `ConvexError<{ code, message }>`. These are the codes the
// UI explains to the member; anything else (offline, a server bug) gets the generic message.
// Among the exchange refusals:
//   - NotPermittedInCircle: accept re-checks the requester's circle permission.
//   - CopyReserved: accept or complete while a puzzle in the deal is set aside for another accepted
//     exchange, or out on loan.
//   - RecipientNotOwner / OfferedCopyNotOwned / CopyNotFound: a puzzle in the deal changed hands
//     or is gone since it was proposed, so the deal can't settle any more.
const EXCHANGE_KEYS = new Map<string, string>([
  ["IllegalTransition", "errors.IllegalTransition"],
  ["WrongParty", "errors.WrongParty"],
  ["ExchangeNotFound", "errors.ExchangeNotFound"],
  ["NotPermittedInCircle", "errors.NotPermittedInCircle"],
  ["NotConnected", "errors.NotConnected"],
  ["CopyNotAvailable", "errors.CopyNotAvailable"],
  ["CopyReserved", "errors.copyReserved"],
  ["RecipientNotOwner", "errors.copyChangedHands"],
  ["OfferedCopyNotOwned", "errors.copyChangedHands"],
  ["CopyNotFound", "errors.copyChangedHands"],
]);

const LOAN_KEYS = new Map<string, string>([
  ["LoanNotFound", "errors.LoanNotFound"],
  ["LoanNotOpen", "errors.LoanNotOpen"],
  ["NotBorrower", "errors.NotBorrower"],
  ["NotLender", "errors.NotLender"],
]);

const keyFor = (keys: ReadonlyMap<string, string>, error: unknown): string =>
  keys.get(convexErrorCode(error) ?? "") ?? "errors.generic";

/** The `trades` namespace key explaining why an exchange action failed. */
export const exchangeErrorKey = (error: unknown): string =>
  keyFor(EXCHANGE_KEYS, error);

/** The `lending` namespace key explaining why returning or recalling a loan failed. */
export const loanErrorKey = (error: unknown): string =>
  keyFor(LOAN_KEYS, error);
