import { DomainError } from "../../shared-kernel";

// A closed set of reasons a Library aggregate operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried in a
// Result interchangeably (mirrors ExchangeError).
export type LibraryErrorCode =
  | "NotOwner"
  | "InvalidCondition"
  | "InvalidPrice"
  | "DuplicateCollectionName"
  | "CannotDeleteDefaultCollection"
  | "CopyNotInCollection"
  | "WrongMemberType"
  | "CannotLendToSelf"
  | "LoanNotOpen"
  | "NotBorrower"
  | "NotLender";

export class LibraryError extends DomainError {
  override readonly name = "LibraryError";

  private constructor(
    readonly code: LibraryErrorCode,
    message: string,
  ) {
    super(message);
  }

  // The acting member does not own the aggregate they tried to mutate.
  static notOwner(action: string): LibraryError {
    return new LibraryError("NotOwner", `Acting member may not ${action}`);
  }

  // A condition value outside the known grading set.
  static invalidCondition(value: string): LibraryError {
    return new LibraryError("InvalidCondition", `Unknown condition: ${value}`);
  }

  // A price (sale or acquisition) failed validation.
  static invalidPrice(detail: string): LibraryError {
    return new LibraryError("InvalidPrice", `Invalid price: ${detail}`);
  }

  // Two collections of the same owner cannot share a name (the uniqueness check is an
  // application concern; this is the aggregate-level signal for the same rule).
  static duplicateCollectionName(name: string): LibraryError {
    return new LibraryError(
      "DuplicateCollectionName",
      `A collection named "${name}" already exists`,
    );
  }

  // A default (system) collection cannot be removed.
  static cannotDeleteDefaultCollection(): LibraryError {
    return new LibraryError(
      "CannotDeleteDefaultCollection",
      "A default collection cannot be deleted",
    );
  }

  // Tried to remove a copy that is not a member of the collection.
  static copyNotInCollection(): LibraryError {
    return new LibraryError(
      "CopyNotInCollection",
      "The copy is not a member of this collection",
    );
  }

  // Tried to add the wrong kind of member (a CopyId to a wishlist, or a definition to a
  // regular collection).
  static wrongMemberType(detail: string): LibraryError {
    return new LibraryError("WrongMemberType", detail);
  }

  // A member cannot lend a copy to themselves.
  static cannotLendToSelf(): LibraryError {
    return new LibraryError("CannotLendToSelf", "A copy cannot be lent to its owner");
  }

  // An action requiring an open loan was attempted on one already returned/recalled.
  static loanNotOpen(): LibraryError {
    return new LibraryError("LoanNotOpen", "The loan is not open");
  }

  // Only the borrower may return a loan.
  static notBorrower(): LibraryError {
    return new LibraryError("NotBorrower", "Only the borrower may return this loan");
  }

  // Only the lender (owner) may recall a loan.
  static notLender(): LibraryError {
    return new LibraryError("NotLender", "Only the owner may recall this loan");
  }
}
